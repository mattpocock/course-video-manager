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
 * which it draws on the CPU over the picture, at one fixed place (#2462).
 *
 * TIMING. Frame n IS picture time n/60: the stream reads the frames' count
 * as their stamps (rawvideo at 60 fps under `-copyts`), and its composite is
 * clocked on the same exact 1/60 grid from file time 0 (`liveSceneFilterGraph`),
 * so every picture frame pairs with the card frame of its own slot, never a
 * neighbour's. Frames are sent once the recorder's Windows clock has reached
 * them (with a burst at connect, from T0), never ahead. A click changes the
 * card from the first frame stamped at or after it, never earlier, however
 * far behind the stream is reading. While hidden or settled it sends the
 * same frame again, so the composite never waits on it. A slot it reaches
 * late (`LATE_MS`) carries the last frame sent again, so it is back on the
 * clock at once: the stream's overlay pairs every picture frame with a card
 * frame, so a feed that fell behind would hold the picture (ADR 0054,
 * amended 2026-10-31).
 *
 * It never skips a frame (their count is their time): while the stream is
 * slow to read (its start-up), it waits for the socket to drain, holding at
 * most `MAX_BUFFERED_SECONDS` of frames. Each stream process connects afresh
 * (a relaunch, #2459), its frames starting at its own picture's start, so
 * the card follows the canvas there too. Raw footage first: it only feeds
 * the stream, and a stream whose card input ends carries on without it
 * (`eof_action=pass`).
 */

export const CARD_FPS = 60;
const FRAME_MS = 1000 / CARD_FPS;

/** Seconds of frames held for a stream slow to read, before the feed waits. */
const MAX_BUFFERED_SECONDS = 1;

/**
 * A slot the feed reaches more than this long after the clock passed it is
 * late (the service was busy, or its clock jumped on): it carries the last
 * frame sent again, drawing nothing, so the feed is back on the clock at
 * once and the picture never waits on it. Changes due then land on the
 * first slot on time, stamped there.
 */
const LATE_MS = 100;

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

/** How long an exit lasts on the picture, in whole frames: the last is fully faded. */
const EXIT_MS = Math.ceil(CHAT_HIGHLIGHT_MOTION.exit.ms / FRAME_MS) * FRAME_MS;

type Phase =
  | { kind: "hidden" }
  | {
      kind: "entering";
      card: Planes;
      /** The Windows time of its first frame. */
      startMs: number;
      from: ChatHighlightPose;
    }
  | {
      kind: "exiting";
      card: Planes;
      startMs: number;
      from: ChatHighlightPose;
      /** A card to enter once this one has gone (a replace). */
      next?: { card: Planes; shown: (s: CardStamp) => void };
    };

export const createCardFeed = (o: {
  /** The recorder's Windows clock, ms. */
  now: () => number;
  /** The card server's canvas: every still is this size. */
  still: { width: number; height: number };
}) => {
  const size = cardFrameSize(o.still);
  let t0Ms: number | undefined;
  /**
   * The stream process reading it now, and where its frames start: each
   * launch (a relaunch too) connects afresh, its picture starting at the
   * file time `launching` said.
   */
  let reader:
    | {
        socket: net.Socket;
        startSeconds: number;
        frame: number;
        draining: boolean;
      }
    | undefined;
  /** Where the next launch's picture starts, in file time (s). */
  let nextStartSeconds = 0;
  let gone = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let phase: Phase = { kind: "hidden" };
  /** Changes asked for, applied from the first frame at or after their time. */
  let pending: { notBeforeMs: number; apply: (at: CardStamp) => void }[] = [];
  let cache: { key: string; frame: Buffer } | undefined;
  const hiddenFrame = drawFrame(size, null, CHAT_HIGHLIGHT_HIDDEN);
  /** The frame sent last, which a late slot carries again. */
  let lastSent: Buffer = hiddenFrame;
  /** Fails every stamp still to come once the feed has closed. */
  let failStamps!: (e: Error) => void;
  const stopped = new Promise<never>((_, reject) => (failStamps = reject));
  stopped.catch(() => {});
  const stamped = (p: Promise<CardStamp>) => {
    const raced = Promise.race([p, stopped]);
    // One a replace never waits for (its exit) must not go unhandled.
    raced.catch(() => {});
    return raced;
  };

  /** The reader's frame `i`: its Windows time. */
  const stampOf = (r: NonNullable<typeof reader>, i: number): CardStamp => ({
    frame: i,
    atMs: t0Ms! + r.startSeconds * 1000 + i * FRAME_MS,
  });

  /** The card's pose on the frame at `atMs`, the first of a move counting as one frame in. */
  const poseAt = (atMs: number): ChatHighlightPose => {
    if (phase.kind === "hidden") return CHAT_HIGHLIGHT_HIDDEN;
    const ms = atMs - phase.startMs + FRAME_MS;
    return phase.kind === "entering"
      ? enteringPose(ms, phase.from)
      : exitingPose(ms, phase.from);
  };

  /** Moves the phase on at `at`: an exit over, the next card enters. */
  const advance = (at: CardStamp) => {
    if (phase.kind !== "exiting" || at.atMs - phase.startMs < EXIT_MS - 0.5)
      return;
    const next = phase.next;
    phase = next
      ? {
          kind: "entering",
          card: next.card,
          startMs: at.atMs,
          from: CHAT_HIGHLIGHT_HIDDEN,
        }
      : { kind: "hidden" };
    next?.shown(at);
  };

  const frameAt = (at: CardStamp) => {
    advance(at);
    const due = pending.filter((c) => at.atMs >= c.notBeforeMs - FRAME_MS / 2);
    pending = pending.filter((c) => !due.includes(c));
    for (const c of due) c.apply(at);
    if (phase.kind === "hidden") return hiddenFrame;
    const pose = poseAt(at.atMs);
    const key = `${pose.opacity.toFixed(4)}:${pose.offsetY.toFixed(3)}`;
    if (cache?.key !== key)
      cache = { key, frame: drawFrame(size, phase.card, pose) };
    return cache.frame;
  };

  const tick = () => {
    clearTimeout(timer);
    const r = reader;
    if (gone || !r || t0Ms === undefined) return;
    let now: number;
    try {
      now = o.now();
    } catch {
      timer = setTimeout(tick, FRAME_MS);
      return;
    }
    while (stampOf(r, r.frame).atMs <= now) {
      if (
        r.socket.writableLength >
        MAX_BUFFERED_SECONDS * CARD_FPS * hiddenFrame.length
      ) {
        if (!r.draining) {
          r.draining = true;
          r.socket.once("drain", () => {
            r.draining = false;
            tick();
          });
        }
        return;
      }
      const at = stampOf(r, r.frame);
      if (now - at.atMs <= LATE_MS) lastSent = frameAt(at);
      r.socket.write(lastSent);
      r.frame += 1;
    }
    timer = setTimeout(tick, Math.max(1, stampOf(r, r.frame).atMs - now));
  };

  /** Its reader went (the stream process quit): the next launch connects again. */
  const readerGone = (r: NonNullable<typeof reader>) => {
    if (reader !== r) return;
    reader = undefined;
    clearTimeout(timer);
  };

  const server = net.createServer((s) => {
    if (gone) return void s.destroy();
    // One stream process reads it at a time: the newest. A relaunched one
    // can connect before the last one's socket has closed, and must never
    // be turned away (its card input would fail, and it would quit).
    if (reader) {
      const old = reader;
      readerGone(old);
      old.socket.destroy();
    }
    const r = {
      socket: s,
      startSeconds: nextStartSeconds,
      frame: 0,
      draining: false,
    };
    reader = r;
    s.setNoDelay(true);
    s.on("error", () => {});
    s.on("close", () => readerGone(r));
    tick();
  });
  const listening = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as net.AddressInfo).port)
    );
  });

  /** Asks for a change from the first frame at or after now; settles with its stamp. */
  const change = (apply: (at: CardStamp) => void) => {
    let notBeforeMs: number;
    try {
      notBeforeMs = o.now();
    } catch {
      notBeforeMs = 0;
    }
    pending.push({ notBeforeMs, apply });
  };

  /** Starts an exit at `at` from wherever the card is. */
  const exitAt = (at: CardStamp, card: Planes) => {
    const from = poseAt(at.atMs - FRAME_MS);
    phase = { kind: "exiting", card, startMs: at.atMs, from };
    return phase;
  };

  return {
    /** The loopback port the stream reads the card from. */
    port: () => listening,
    /** The streamed Recording Session's T0: frames flow from here on. */
    begin: (t0: number) => {
      t0Ms = t0;
      tick();
    },
    /** A stream process is launching; its picture starts at this file time (s). */
    launching: (startSeconds: number) => {
      nextStartSeconds = startSeconds;
    },
    /** Whether it can take a change: until it is closed, once T0 is known. */
    running: () => !gone && t0Ms !== undefined,
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
        change((at) => {
          if (phase.kind === "entering") {
            exitAt(at, phase.card).next = { card, shown: resolveShown };
          } else if (phase.kind === "exiting") {
            phase.next = { card, shown: resolveShown };
          } else {
            phase = {
              kind: "entering",
              card,
              startMs: at.atMs,
              from: CHAT_HIGHLIGHT_HIDDEN,
            };
            resolveShown(at);
          }
          hide?.(at);
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
          change((at) => {
            if (phase.kind === "entering") exitAt(at, phase.card);
            else if (phase.kind === "exiting") phase.next = undefined;
            resolve(at);
          })
        )
      ),
    close: () => {
      if (gone) return;
      gone = true;
      failStamps(new Error("The card feed closed."));
      clearTimeout(timer);
      reader?.socket.destroy();
      server.close();
    },
  };
};
