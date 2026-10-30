import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ChatHighlightEvent } from "../../recorder-service/chat-highlight-protocol";
import type { RecorderMessage } from "../../recorder-service/protocol";
import { CHAT_HIGHLIGHT_MOTION } from "@cvm/core/features/videos/chat-highlight-motion";
import { hold, type Ctx } from "./takes";

/**
 * THE CHAT HIGHLIGHT CHECKS (#2461), in the streamed Recording Session
 * (`streamed.ts`'s `during`): Matt's clicks, scripted with fake chat
 * messages, then the card on the Live Stream picture the sink kept.
 *
 * - Click to on screen: from the click reaching the service to the card's
 *   first visible frame, as the service stamps it. Target 1 s or less.
 * - Monotonic opacity: around every edge, the card's opacity on the picture
 *   only rises (shown) or only falls (hidden), and does not change before
 *   the stamped frame: no frame of its next state early (spec #2445, story
 *   75; the spike saw 13 such frames in 17 clicks).
 */

/** Clicks the scorecard makes: enough to meet the spike's 17. */
export const CARD_CLICKS = 20;

/** Between clicks: every move done, and a moment settled. */
const CLICK_GAP_MS = 1_500;

/**
 * Before the first click: the card server starts once the stream is live
 * (`chat-highlights.ts`) and takes a few seconds to warm. A click sooner
 * waits for it (about 3 s in the first runs), as Matt's would.
 */
const WARM_UP_MS = 10_000;

type Edge = ChatHighlightEvent;

/**
 * Show, hide, show, replace (show another while one shows), hide, …: every
 * kind of edge Matt makes, at a steady pace, on fake messages only.
 */
const script = (i: number): "show" | "hide" =>
  ["show", "hide", "show", "show", "hide"][i % 5] as "show" | "hide";

/** The clicks: each edge the service logged for them, in order. */
export const cardClicks = async (ctx: Ctx) => {
  const edges: Edge[] = [];
  const isEdge = (m: RecorderMessage) =>
    m.type === "chat-highlight-shown" || m.type === "chat-highlight-hidden";
  let showing: string | undefined;
  await hold(ctx, WARM_UP_MS);
  for (let i = 0; i < CARD_CLICKS; i++) {
    const show = script(i) === "show" || !showing;
    const id = show ? randomUUID() : showing!;
    const sent = ctx.client.send(
      show
        ? {
            type: "show-highlight",
            highlightId: id,
            broadcastId: "scorecard-broadcast",
            messageId: `scorecard-message-${i}`,
            author: `@fake_viewer_${i}`,
            text: `Fake question ${i}: does the card land smoothly?`,
          }
        : { type: "hide-highlight", highlightId: id }
    );
    const edge = show ? "chat-highlight-shown" : "chat-highlight-hidden";
    const answer = await ctx.client.waitFor(
      (m) => (m.type === edge && m.highlightId === id) || m.type === "refused",
      { from: sent.from, timeoutMs: 30_000, what: `card click ${i}` }
    );
    if (answer.message.type === "refused")
      throw new Error(`Card click ${i} refused: ${answer.message.message}`);
    edges.push(
      ...ctx.client.received
        .slice(sent.from)
        .map((r) => r.message)
        .filter((m): m is Extract<RecorderMessage, Edge> => isEdge(m))
    );
    showing = show ? id : undefined;
    await hold(ctx, CLICK_GAP_MS);
  }
  return edges;
};

/** The card's opacity on each frame of the sink's file, by its stream time. */
const opacityByFrame = async (sinkFile: string, patch: CardPatch) => {
  const run = promisify(execFile);
  const pts = (
    await run(
      "nice",
      [
        "-n",
        "19",
        "taskset",
        "-c",
        "6-9",
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "packet=pts_time",
        "-of",
        "csv=p=0",
        sinkFile,
      ],
      { maxBuffer: 64 << 20 }
    )
  ).stdout
    .split("\n")
    .map(Number)
    .filter((t) => Number.isFinite(t) && t > 0)
    .sort((a, b) => a - b);
  const { stdout } = await run(
    "nice",
    [
      "-n",
      "19",
      "taskset",
      "-c",
      "6-9",
      "ffmpeg",
      "-v",
      "error",
      "-i",
      sinkFile,
      "-vf",
      `crop=${patch.w}:${patch.h}:${patch.x}:${patch.y},format=yuv444p`,
      "-fps_mode",
      "passthrough",
      "-f",
      "rawvideo",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 1 << 30 }
  );
  const size = patch.w * patch.h;
  const frames = Math.min(pts.length, Math.floor(stdout.length / (3 * size)));
  // The accent bar's blue difference (U): far from any grey backdrop's.
  const u = Array.from({ length: frames }, (_, f) => {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += stdout[f * 3 * size + size + i]!;
    return sum / size;
  });
  const sorted = [...u].sort((a, b) => a - b);
  const card = sorted[Math.floor(frames * 0.02)]!;
  const backdrop = sorted[Math.floor(frames * 0.98)]!;
  return u.map((v, f) => ({
    t: pts[f]!,
    opacity: Math.min(1, Math.max(0, (backdrop - v) / (backdrop - card))),
  }));
};

/** A patch of the card's accent bar on the 1920x1080 picture (`stream-args.ts`). */
export type CardPatch = { x: number; y: number; w: number; h: number };

/** The settled card's accent bar, 40 rows of it, clear of its 12 px travel. */
export const ACCENT_PATCH: CardPatch = { x: 50, y: 960, w: 4, h: 40 };

/** Opacity steps this small are the encoder's noise, not the card. */
const NOISE = 0.06;

/**
 * Every edge's frames, from just before it (or the last edge's end) to the
 * end of its move: steps the wrong way, and changes before its stamp.
 */
export const cardOpacityCheck = async (
  sinkFile: string,
  edges: readonly Edge[]
) => {
  const frames = await opacityByFrame(sinkFile, ACCENT_PATCH);
  // The picture's time against file time: over every shown edge, the median
  // delay from its stamp to the first frame that changed (most are clean; a
  // hide's first frame is within the noise).
  const delays = edges.flatMap((e) => {
    if (e.type !== "chat-highlight-shown") return [];
    const near = frames.filter(
      (f) => f.t >= e.fileTime - 0.3 && f.t <= e.fileTime + 0.3
    );
    const before = near[0]?.opacity;
    const changed = near.find(
      (f) => before !== undefined && Math.abs(f.opacity - before) > 0.15
    );
    return changed ? [changed.t - e.fileTime] : [];
  });
  const offset =
    [...delays].sort((a, b) => a - b)[Math.floor(delays.length / 2)] ?? 0;
  let wrongWay = 0;
  let early = 0;
  /** How long an edge's move lasts on the picture (`chat-highlight-motion.ts`). */
  const moveOf = (e: Edge) =>
    (e.type === "chat-highlight-shown"
      ? CHAT_HIGHLIGHT_MOTION.enter.ms
      : CHAT_HIGHLIGHT_MOTION.exit.ms) / 1000;
  const perEdge = edges.map((e, k) => {
    const at = e.fileTime + offset;
    const moveS = moveOf(e) + 0.05;
    const prev = edges[k - 1];
    // From just before it, or from the end of the last move (a replace's exit).
    const from = Math.max(
      at - 0.1,
      prev ? prev.fileTime + offset + moveOf(prev) - 0.008 : 0
    );
    // To the end of its move, or the next edge (a replace's entrance).
    const next = edges[k + 1];
    const to = Math.min(
      at + moveS,
      next ? next.fileTime + offset - 0.008 : Infinity
    );
    const window = frames.filter((f) => f.t >= from - 1e-6 && f.t <= to);
    const sign = e.type === "chat-highlight-shown" ? 1 : -1;
    const before = window.filter((f) => f.t < at - 0.008);
    const settled = before[0]?.opacity;
    const earlyHere = before.filter(
      (f) => settled !== undefined && Math.abs(f.opacity - settled) > NOISE
    ).length;
    let wrongHere = 0;
    for (let i = 1; i < window.length; i++)
      if (sign * (window[i]!.opacity - window[i - 1]!.opacity) < -NOISE)
        wrongHere += 1;
    wrongWay += wrongHere;
    early += earlyHere;
    return {
      type: e.type,
      fileTime: e.fileTime,
      opacity: window.map((f) => Number(f.opacity.toFixed(2))),
      wrongWay: wrongHere,
      early: earlyHere,
    };
  });
  return { frames: frames.length, offsetS: offset, wrongWay, early, perEdge };
};

/** Click to on screen, per shown edge: its stamp less when the click reached the service. */
export const clickToScreenMs = (edges: readonly Edge[]) =>
  edges.flatMap((e) =>
    e.type === "chat-highlight-shown" ? [e.atMs - e.receivedAtMs] : []
  );

/**
 * The streamed scenario's `during` step: the clicks while live, then, once
 * the sink has closed its file, the measurements (after the stream ones in
 * `metrics.ts`).
 */
export const cardChecks =
  (ctx: Ctx) =>
  async ({ sinkFile }: { sinkFile: string }) => {
    const edges = await cardClicks(ctx);
    return async () => {
      const clicks = clickToScreenMs(edges);
      const opacity = await cardOpacityCheck(sinkFile, edges);
      ctx.measured.card_click_to_screen_ms =
        clicks.length > 0 ? Math.max(...clicks) : null;
      ctx.measured.card_opacity_wrong_frames = opacity.wrongWay + opacity.early;
      ctx.details.chatHighlights = {
        clicks: CARD_CLICKS,
        edges: edges.length,
        clickToScreenMs: clicks.map(Math.round),
        ...opacity,
      };
    };
  };
