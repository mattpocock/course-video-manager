import net from "node:net";
import {
  CHAT_HIGHLIGHT_HIDDEN,
  CHAT_HIGHLIGHT_MOTION,
  CHAT_HIGHLIGHT_TRAVEL_PX,
  enteringPose,
  exitingPose,
  type ChatHighlightPose,
} from "@cvm/core/features/videos/chat-highlight-motion";

/**
 * THE CARD FEED (spec #2445, option (b)): the Chat Highlight card's still,
 * eased here in Node, sent to the Live Stream process as raw yuva420p frames,
 * which it uploads and draws with `overlay_cuda` at one fixed place.
 *
 * TIMING. Frame n IS picture time n/60: the stream reads the frames' count
 * as their stamps (rawvideo at 60 fps under `-copyts`), and its composite is
 * clocked on the same exact 1/60 grid from file time 0 (`liveSceneFilterGraph`),
 * so every picture frame pairs with the card frame of its own slot, never a
 * neighbour's. Frames are sent once the recorder's Windows clock has reached
 * them (with a burst at connect, from T0), never ahead. A click changes the
 * card from the first frame stamped at or after it, never earlier, however
 * far behind the stream is reading. While hidden or settled it sends the
 * same frame again, so the composite never waits on it.
 *
 * It never skips a frame (their count is their time): while the stream is
 * slow to read (its start-up), it waits for the socket to drain, holding at
 * most `MAX_BUFFERED_SECONDS` of frames. Raw footage first: it only feeds
 * the stream; if the stream goes, the feed ends, and a stream whose card
 * input ends carries on without it (`eof_action=pass`).
 */

export const CARD_FPS = 60;
const FRAME_MS = 1000 / CARD_FPS;

/** Seconds of frames held for a stream slow to read, before the feed waits. */
const MAX_BUFFERED_SECONDS = 1;

/** A card still as the feed draws it: straight RGBA from the card server. */
export type CardStill = { width: number; height: number; rgba: Buffer };

/** When an edge reached the picture: its frame, and that frame's Windows time. */
export type CardStamp = { frame: number; atMs: number };

/**
 * The still in planes, BT.709 limited range as every frame of the stream is
 * tagged: Y and A at full size, U and V halved (each 2x2 block weighted by
 * its alpha, so a transparent pixel's colour never tints the card's edge).
 * Once per click, in a few milliseconds.
 */
const planesOf = (still: CardStill) => {
  const { width: w, height: h, rgba } = still;
  const Y = new Float32Array(w * h);
  const A = new Float32Array(w * h);
  const cw = w / 2;
  const U = new Float32Array(cw * (h / 2));
  const V = new Float32Array(cw * (h / 2));
  const weight = new Float32Array(U.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = rgba[i * 4]!;
      const g = rgba[i * 4 + 1]!;
      const b = rgba[i * 4 + 2]!;
      const a = rgba[i * 4 + 3]!;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      Y[i] = 16 + (219 * luma) / 255;
      A[i] = a;
      const c = (y >> 1) * cw + (x >> 1);
      U[c]! += ((224 * (b - luma)) / 255 / 1.8556) * a;
      V[c]! += ((224 * (r - luma)) / 255 / 1.5748) * a;
      weight[c]! += a;
    }
  for (let c = 0; c < U.length; c++) {
    const wt = weight[c]!;
    U[c] = 128 + (wt ? U[c]! / wt : 0);
    V[c] = 128 + (wt ? V[c]! / wt : 0);
  }
  return { w, h, Y, A, U, V };
};

type Planes = ReturnType<typeof planesOf>;

/**
 * The frame size for a still of `still`: its width, and its height plus the
 * card's travel, so the card can sit lower by up to that much.
 */
export const cardFrameSize = (still: { width: number; height: number }) => ({
  width: still.width,
  height: still.height + CHAT_HIGHLIGHT_TRAVEL_PX,
});

/**
 * One plane of a frame: `src` (`w` wide, `h` tall) drawn `dy` rows down,
 * between whole rows by a linear blend, times `gain`, and `outside` where
 * the still is not.
 */
const drawPlane = (
  out: Buffer,
  at: number,
  rows: number,
  src: Float32Array,
  w: number,
  h: number,
  dy: number,
  gain: number,
  outside: number
) => {
  for (let r = 0; r < rows; r++) {
    const row = r - dy;
    const r0 = Math.floor(row);
    const f = row - r0;
    const top = r0 >= 0 && r0 < h ? r0 * w : -1;
    const bottom = r0 + 1 >= 0 && r0 + 1 < h ? (r0 + 1) * w : -1;
    const o = at + r * w;
    if (top < 0 && bottom < 0) {
      out.fill(Math.round(outside * gain), o, o + w);
      continue;
    }
    for (let c = 0; c < w; c++) {
      const v0 = top < 0 ? outside : src[top + c]!;
      const v1 = bottom < 0 ? outside : src[bottom + c]!;
      out[o + c] = (v0 + (v1 - v0) * f) * gain + 0.5;
    }
  }
};

/** One yuva420p frame: the still `offsetY` rows down (sub-pixel), its alpha scaled. */
const drawFrame = (
  size: { width: number; height: number },
  p: Planes | null,
  pose: ChatHighlightPose
) => {
  const { width: W, height: H } = size;
  const out = Buffer.alloc(W * H * 2.5);
  const uAt = W * H;
  const vAt = uAt + (W / 2) * (H / 2);
  const aAt = vAt + (W / 2) * (H / 2);
  out.fill(16, 0, uAt);
  out.fill(128, uAt, aAt);
  if (!p || pose.opacity <= 0) return out;
  const dy = Math.min(Math.max(pose.offsetY, 0), CHAT_HIGHLIGHT_TRAVEL_PX);
  drawPlane(out, 0, H, p.Y, W, p.h, dy, 1, 16);
  drawPlane(out, aAt, H, p.A, W, p.h, dy, pose.opacity, 0);
  drawPlane(out, uAt, H / 2, p.U, W / 2, p.h / 2, dy / 2, 1, 128);
  drawPlane(out, vAt, H / 2, p.V, W / 2, p.h / 2, dy / 2, 1, 128);
  return out;
};

/** Frames an exit lasts: the last is fully faded. */
const EXIT_FRAMES = Math.ceil(CHAT_HIGHLIGHT_MOTION.exit.ms / FRAME_MS);

type Phase =
  | { kind: "hidden" }
  | { kind: "entering"; card: Planes; start: number; from: ChatHighlightPose }
  | {
      kind: "exiting";
      card: Planes;
      start: number;
      from: ChatHighlightPose;
      /** A card to enter once this one has gone (a replace). */
      next?: { card: Planes; shown: (s: CardStamp) => void };
    };

export const createCardFeed = (o: {
  /** The recorder's Windows clock, ms. */
  now: () => number;
  /** The card server's canvas: every still is this size. */
  still: { width: number; height: number };
  /** Said once, when the feed stops by itself (the stream went or fell behind). */
  onGone: (why: string) => void;
}) => {
  const size = cardFrameSize(o.still);
  let t0Ms: number | undefined;
  let socket: net.Socket | undefined;
  let gone = false;
  let n = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let phase: Phase = { kind: "hidden" };
  /** Changes asked for, applied before the next frame is drawn. */
  let pending: { notBeforeMs: number; apply: (frame: number) => void }[] = [];
  /** Waiting for the socket to drain. */
  let draining = false;
  let cache: { key: string; frame: Buffer } | undefined;
  const hiddenFrame = drawFrame(size, null, CHAT_HIGHLIGHT_HIDDEN);
  /** Fails every stamp still to come once the feed has stopped. */
  let failStamps!: (e: Error) => void;
  const stopped = new Promise<never>((_, reject) => (failStamps = reject));
  stopped.catch(() => {});
  const stamped = (p: Promise<CardStamp>) => {
    const raced = Promise.race([p, stopped]);
    // One a replace never waits for (its exit) must not go unhandled.
    raced.catch(() => {});
    return raced;
  };

  const stamp = (frame: number): CardStamp => ({
    frame,
    atMs: t0Ms! + frame * FRAME_MS,
  });

  /** The card's pose on frame `f` (`f - start + 1` frames into its move). */
  const poseAt = (f: number): ChatHighlightPose => {
    if (phase.kind === "hidden") return CHAT_HIGHLIGHT_HIDDEN;
    const ms = (f - phase.start + 1) * FRAME_MS;
    return phase.kind === "entering"
      ? enteringPose(ms, phase.from)
      : exitingPose(ms, phase.from);
  };

  /** Moves the phase on at frame `f`: an exit over, the next card enters. */
  const advance = (f: number) => {
    if (phase.kind !== "exiting" || f - phase.start < EXIT_FRAMES) return;
    const next = phase.next;
    phase = next
      ? {
          kind: "entering",
          card: next.card,
          start: f,
          from: CHAT_HIGHLIGHT_HIDDEN,
        }
      : { kind: "hidden" };
    next?.shown(stamp(f));
  };

  const frameAt = (f: number) => {
    advance(f);
    // A change asked for at a time applies from that time's frame on.
    const due = pending.filter(
      (c) => stamp(f).atMs >= c.notBeforeMs - FRAME_MS / 2
    );
    pending = pending.filter((c) => !due.includes(c));
    for (const c of due) c.apply(f);
    if (phase.kind === "hidden") return hiddenFrame;
    const pose = poseAt(f);
    const key = `${pose.opacity.toFixed(4)}:${pose.offsetY.toFixed(3)}`;
    if (cache?.key !== key)
      cache = { key, frame: drawFrame(size, phase.card, pose) };
    return cache.frame;
  };

  const stop = (why: string | null) => {
    if (gone) return;
    gone = true;
    failStamps(new Error(`The card feed stopped: ${why ?? "closed"}.`));
    clearTimeout(timer);
    socket?.destroy();
    server.close();
    if (why) o.onGone(why);
  };

  const tick = () => {
    clearTimeout(timer);
    if (gone || !socket || t0Ms === undefined) return;
    let now: number;
    try {
      now = o.now();
    } catch {
      timer = setTimeout(tick, FRAME_MS);
      return;
    }
    while (stamp(n).atMs <= now) {
      if (
        socket.writableLength >
        MAX_BUFFERED_SECONDS * CARD_FPS * hiddenFrame.length
      ) {
        if (!draining) {
          draining = true;
          socket.once("drain", () => {
            draining = false;
            tick();
          });
        }
        return;
      }
      socket.write(frameAt(n));
      n += 1;
    }
    timer = setTimeout(tick, Math.max(1, stamp(n).atMs - now));
  };

  const server = net.createServer((s) => {
    // One stream process reads it; a second connection is not a reader.
    if (socket || gone) return void s.destroy();
    socket = s;
    s.setNoDelay(true);
    s.on("error", () => {});
    s.on("close", () => stop("the stream closed the card feed"));
    tick();
  });
  const listening = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as net.AddressInfo).port)
    );
  });

  /** Asks for a change at the next frame drawn; settles with its stamp. */
  const change = (apply: (frame: number) => void) => {
    let notBeforeMs: number;
    try {
      notBeforeMs = o.now();
    } catch {
      notBeforeMs = 0;
    }
    pending.push({ notBeforeMs, apply });
  };

  return {
    /** The loopback port the stream reads the card from. */
    port: () => listening,
    /** The streamed Recording Session's T0: frame 0's Windows time. */
    begin: (t0: number) => {
      t0Ms = t0;
      tick();
    },
    /** Whether it is feeding a stream now. */
    running: () => !gone && socket !== undefined && t0Ms !== undefined,
    /**
     * Shows `still`: at once if no card shows, else after the shown one has
     * gone (`hidden` then stamps its exit). `shown` stamps the first frame
     * the new card is on.
     */
    show: (still: CardStill) => {
      const card = planesOf(still);
      let hide: ((s: CardStamp) => void) | undefined;
      // A card on the picture now leaves first: its exit is stamped too.
      const hidden =
        phase.kind === "entering"
          ? new Promise<CardStamp>((r) => (hide = r))
          : null;
      const shown = new Promise<CardStamp>((resolveShown) => {
        change((f) => {
          if (phase.kind === "entering") {
            const from = poseAt(f - 1);
            phase = { kind: "exiting", card: phase.card, start: f, from };
            phase.next = { card, shown: resolveShown };
            hide?.(stamp(f));
          } else if (phase.kind === "exiting") {
            phase.next = { card, shown: resolveShown };
            hide?.(stamp(f));
          } else {
            phase = {
              kind: "entering",
              card,
              start: f,
              from: CHAT_HIGHLIGHT_HIDDEN,
            };
            hide?.(stamp(f));
            resolveShown(stamp(f));
          }
        });
      });
      return {
        hidden: hidden && stamped(hidden),
        shown: stamped(shown),
      };
    },
    /** Hides the card showing; stamps the first frame of its exit. */
    hide: () =>
      stamped(
        new Promise<CardStamp>((resolve) =>
          change((f) => {
            if (phase.kind === "entering") {
              const from = poseAt(f - 1);
              phase = { kind: "exiting", card: phase.card, start: f, from };
            } else if (phase.kind === "exiting") phase.next = undefined;
            resolve(stamp(f));
          })
        )
      ),
    close: () => stop(null),
  };
};
