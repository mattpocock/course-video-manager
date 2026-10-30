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
 * listens once, takes the push, throws the packets away and counts them on
 * its own `-progress`.
 */
export const sinkArgs = (port: number, marker: string) => [
  "-hide_banner",
  "-nostats",
  "-loglevel",
  "level+warning",
  "-progress",
  "pipe:1",
  "-stats_period",
  "1",
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
  "-f",
  "null",
  "-",
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
      frame: Number(block.frame ?? 0),
      fps: Number(block.fps ?? 0),
      dupFrames: Number(block.dup_frames ?? 0),
      dropFrames: Number(block.drop_frames ?? 0),
    });
    block = {};
  });
  return {
    samples,
    push: (chunk: string, arrivedAt: number) => {
      at = arrivedAt;
      split(chunk);
    },
  };
};

/**
 * Frames per second of wall time from `from` on: the least-squares slope of
 * frames against arrival time, so no one late block moves it. Null with
 * fewer than ten blocks.
 */
export const streamRate = (
  samples: readonly ProgressSample[],
  from: number
) => {
  const xs = samples.filter((s) => s.at >= from);
  if (xs.length < 10) return null;
  const n = xs.length;
  const mt = xs.reduce((a, s) => a + s.at, 0) / n;
  const mf = xs.reduce((a, s) => a + s.frame, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of xs) {
    num += (s.at - mt) * (s.frame - mf);
    den += (s.at - mt) ** 2;
  }
  return den ? (num / den) * 1000 : null;
};
