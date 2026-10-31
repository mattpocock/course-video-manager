import type {
  LaunchedProcess,
  Launcher,
} from "../../recorder-service/launcher";
import { lineSplitter } from "../../recorder-service/launcher";
import { STREAM_TAG } from "../../recorder-service/stream-args";

/**
 * THE STREAMED SESSION'S STAND-IN FOR YOUTUBE: a local RTMP sink the Live
 * Stream pushes to, the launcher wrap that makes sure it never pushes
 * anywhere else, and the reading of the stream's `-progress`.
 */

/** A fake Stream Key: the real one is never read. */
export const SCORECARD_STREAM_KEY = "scorecard-fake-stream-key";

/** The sink's address, the service's `streamIngest`; the key goes after it. */
export const sinkIngest = (port: number) => `rtmp://127.0.0.1:${port}/live`;

/**
 * The sink, an ffmpeg.exe on Windows (where the stream process runs): it
 * listens once, takes the push, copies it to `file` (a Windows path, on
 * WSL's disk) and counts its frames on its own `-progress`.
 */
export const sinkArgs = (port: number, marker: string, file: string) => [
  "-hide_banner",
  "-nostats",
  "-loglevel",
  "level+warning",
  "-progress",
  "pipe:1",
  "-stats_period",
  "1",
  // The stream's own stamps, its file time, kept in the file.
  "-copyts",
  "-listen",
  "1",
  "-f",
  "flv",
  "-i",
  `${sinkIngest(port)}/${SCORECARD_STREAM_KEY}`,
  "-c",
  "copy",
  "-metadata",
  `comment=cvm-scorecard-sink ${marker}`,
  // Kept (a stream copy, no decode) so the card checks can read the picture.
  "-f",
  "flv",
  "-y",
  file,
];

/** A process that never started: it says why on stderr, then "exits" 1. */
const refusedProcess = (why: string): LaunchedProcess => {
  const err: ((chunk: string) => void)[] = [];
  const exited = new Promise<number>((resolve) =>
    setImmediate(() => {
      for (const l of err) l(`${why}\n`);
      resolve(1);
    })
  );
  return {
    onStdout: () => {},
    onStderr: (l) => void err.push(l),
    writeStdin: () => {},
    exited,
    kill: () => {},
  };
};

/**
 * `launch`, except that a Live Stream process whose push goes anywhere but
 * `ingest` (with none, every one) is never started: it "exits" 1 at once.
 * No scorecard run can reach YouTube, whatever the service is given.
 */
export const onlyToSink =
  (launch: Launcher, ingest: string | undefined): Launcher =>
  (l) => {
    if (
      l.tool === "ffmpeg" &&
      l.args.includes(`comment=${STREAM_TAG}`) &&
      !(ingest && l.args.some((a) => a.includes(`]${ingest}/`)))
    )
      return refusedProcess(
        `scorecard: refused a Live Stream not aimed at the local sink ${ingest}`
      );
    return launch(l);
  };

/** One `-progress` block, and when (ms, any clock) it reached the scorecard. */
export type ProgressSample = {
  at: number;
  /**
   * When it reached the service, on the Windows clock (ms): the clock the
   * stream's frames are stamped on. WSL's own wanders from it by tens of ms
   * (#2482). `at` where the service did not say.
   */
  windowsAt: number;
  frame: number;
  /** ffmpeg's own figure: frames over its whole run, start-up included. */
  fps: number;
  dupFrames: number;
  dropFrames: number;
};

/** Reads `-progress` chunks into one sample per block. */
export const readProgress = () => {
  const samples: ProgressSample[] = [];
  let block: Record<string, string> = {};
  let at = 0;
  let windowsAt = 0;
  const split = lineSplitter((line) => {
    const eq = line.indexOf("=");
    if (eq === -1) return;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key !== "progress") {
      block[key] = value;
      return;
    }
    samples.push({
      at,
      windowsAt,
      frame: Number(block.frame ?? 0),
      fps: Number(block.fps ?? 0),
      dupFrames: Number(block.dup_frames ?? 0),
      dropFrames: Number(block.drop_frames ?? 0),
    });
    block = {};
  });
  return {
    samples,
    push: (chunk: string, arrivedAt: number, windowsMs = arrivedAt) => {
      at = arrivedAt;
      windowsAt = windowsMs;
      split(chunk);
    },
  };
};

/** How far back the least-delayed tick is looked for: WSL's drift in it is a few ms. */
const CLOCK_WINDOW_MS = 10_000;

/**
 * The Windows clock as read from WSL, from PowerShell's ticks: each tick
 * arrives late, never early, by however long WSL took to hear it (hundreds
 * of ms under load). So the clock is the least-delayed tick of the last few
 * seconds, carried on by WSL's clock (#2482).
 */
export const leastDelayedClock = () => {
  const ticks: { at: number; offset: number }[] = [];
  return {
    /** A tick of `windowsMs`, heard at `arrivedAt` (WSL ms). */
    tick: (windowsMs: number, arrivedAt: number) => {
      ticks.push({ at: arrivedAt, offset: windowsMs - arrivedAt });
      while (ticks[0]!.at < arrivedAt - CLOCK_WINDOW_MS) ticks.shift();
    },
    /** Windows ms at `at` (WSL ms); NaN before any tick. */
    now: (at: number) =>
      ticks.length ? at + Math.max(...ticks.map((t) => t.offset)) : NaN,
  };
};

/** The width of the slices a block is picked from: one per slice. */
const SLICE_MS = 2_000;

/** A steady span of ONE stream process, `[from, to)` on the arrival clock (`at`). */
export type Span = readonly [from: number, to: number];

/** Frames ahead of 60 fps on the Windows clock: the larger, the less late it arrived. */
const ahead = (s: ProgressSample) => s.frame - (60 * s.windowsAt) / 1000;

/** `span`'s least-late block of each 2 s slice (blocks reach the scorecard late, never early). */
const picked = (samples: readonly ProgressSample[], [from, to]: Span) => {
  const slices = new Map<number, ProgressSample>();
  for (const s of samples) {
    if (s.at < from || s.at >= to || isNaN(s.windowsAt)) continue;
    const k = Math.floor(s.windowsAt / SLICE_MS);
    const best = slices.get(k);
    if (!best || ahead(s) > ahead(best)) slices.set(k, s);
  }
  return [...slices.values()];
};

/**
 * THE TAKE'S AVERAGE FRAME RATE (decided 2026-10-31, replacing a rate per
 * stretch): frames the stream put out per second of wall time across the
 * whole take, on the Windows clock its frames are stamped on (`windowsAt`;
 * WSL's wanders, #2482). Each span is one process from once it is steady to
 * its end, faults inside it included. The rate is the least-squares slope
 * through every span's least-late blocks, one slope shared by all, each
 * span with its own offset: a relaunch's picture starts at its own frame 0.
 * A stall the stream never catches up from bends it; a lag that wanders and
 * comes back, which at a span's ends would read as rate, does not. That is
 * latency, reported by `streamLag`, not smoothness. Null with fewer than
 * ten slices.
 */
export const takeFps = (
  samples: readonly ProgressSample[],
  spans: readonly Span[]
) => {
  const xss = spans.map((span) => picked(samples, span));
  if (xss.flat().length < 10) return null;
  let num = 0;
  let den = 0;
  for (const xs of xss) {
    if (xs.length < 2) continue;
    const mt = xs.reduce((a, s) => a + s.windowsAt, 0) / xs.length;
    const mf = xs.reduce((a, s) => a + s.frame, 0) / xs.length;
    for (const s of xs) {
      num += (s.windowsAt - mt) * (s.frame - mf);
      den += (s.windowsAt - mt) ** 2;
    }
  }
  return den ? (num / den) * 1000 : null;
};

/**
 * Duplicated and dropped frames over the whole take: every stream process's
 * own last count, a new process starting where the frame count falls.
 */
export const takeDupsDrops = (samples: readonly ProgressSample[]) => {
  let dupFrames = 0;
  let dropFrames = 0;
  samples.forEach((s, i) => {
    const next = samples[i + 1];
    if (next && next.frame >= s.frame) return;
    dupFrames += s.dupFrames;
    dropFrames += s.dropFrames;
  });
  return { dupFrames, dropFrames };
};

/**
 * The stream's lag behind the take over `span`, in ms on the Windows clock:
 * the take's file time less the picture's (frame n is n/60 s), from each
 * 2 s slice's least-late block. Reported, never a bar. Null: no blocks.
 */
export const streamLag = (
  samples: readonly ProgressSample[],
  span: Span,
  t0Ms: number
) => {
  const all = picked(samples, span).map((s) =>
    Math.round(s.windowsAt - t0Ms - (s.frame * 1000) / 60)
  );
  if (!all.length) return null;
  return {
    startMs: all[0]!,
    endMs: all.at(-1)!,
    minMs: Math.min(...all),
    maxMs: Math.max(...all),
    /** Every 10 s, to see where it moved. */
    every10sMs: all.filter((_, i) => i % 5 === 0),
  };
};
