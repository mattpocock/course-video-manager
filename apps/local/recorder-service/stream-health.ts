import fs from "node:fs";
import path from "node:path";
import { lineSplitter } from "./launcher";
import { STREAM_PACKET_LINE } from "./stream-args";
import type { StreamHealth } from "./stream-protocol";

/**
 * THE LIVE STREAM'S HEALTH (spec #2445, stories 46–47): one stream
 * process's `-progress` blocks and its encoded-packet lines, read into the
 * health line's numbers about once a second of the stream's own time,
 * however often `-progress` comes (`STREAM_PROGRESS_SECONDS`). The reconnect
 * count is the stream side's, which outlives any one process.
 */

/** How often health goes out, in seconds of the stream's own time. */
const HEALTH_PERIOD_S = 1;

/** One process's part of the health: all but what outlives it (reconnects, the feeds'). */
export type ProcessHealth = Omit<
  StreamHealth,
  "reconnects" | "feedOverflows" | "feedsDropping"
>;

/** Before a stream process has said anything. */
export const NO_HEALTH: ProcessHealth = {
  fps: null,
  speed: null,
  droppedFrames: 0,
  duplicatedFrames: 0,
  bitrateKbps: null,
};

/** A -progress value as a number; null for `N/A` and the like. */
const numberOf = (value: string | undefined) => {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : null;
};

export const readStreamHealth = (o: {
  /** Each -progress block, with how many frames it has encoded. */
  onBlock: (frame: number) => void;
  onHealth: (health: ProcessHealth) => void;
  /** Whether its push reaches YouTube now: if not, nothing is going out. */
  pushing: () => boolean;
}) => {
  let block: Record<string, string> = {};
  /** Bytes encoded since the last health. */
  let bytes = 0;
  /** The stream's time (s) at the last health. */
  let lastAt: number | undefined;
  /** Wall-clock ms at the last health. */
  let lastWall = -Infinity;

  const blockEnded = () => {
    const b = block;
    block = {};
    o.onBlock(numberOf(b.frame) ?? 0);
    const us = numberOf(b.out_time_us);
    const at = us === null ? null : us / 1e6;
    const since = at === null || lastAt === undefined ? null : at - lastAt;
    if (since !== null && since < HEALTH_PERIOD_S) return;
    // No stream time to go by (`N/A`): a second of wall time, then.
    const wall = Date.now();
    if (at === null && wall - lastWall < HEALTH_PERIOD_S * 1000) return;
    lastWall = wall;
    const kbps =
      since === null ? null : o.pushing() ? (bytes * 8) / 1000 / since : 0;
    bytes = 0;
    if (at !== null) lastAt = at;
    o.onHealth({
      fps: numberOf(b.fps),
      speed: numberOf(b.speed),
      droppedFrames: numberOf(b.drop_frames) ?? 0,
      duplicatedFrames: numberOf(b.dup_frames) ?? 0,
      bitrateKbps: kbps === null ? null : Math.round(kbps),
    });
  };

  return {
    /** Its stdout: `-progress`, `key=value` lines, each block ending `progress=`. */
    stdout: lineSplitter((line) => {
      const eq = line.indexOf("=");
      if (eq === -1) return;
      const key = line.slice(0, eq).trim();
      if (key === "progress") return blockEnded();
      block[key] = line.slice(eq + 1).trim();
    }),
    /** One line of its stderr: an encoded packet's size, or anything else. */
    stderrLine: (line: string) => {
      if (!line.startsWith(STREAM_PACKET_LINE)) return;
      bytes += numberOf(line.slice(STREAM_PACKET_LINE.length)) ?? 0;
    },
  };
};

/** The health log, beside a streamed Recording Session's `events.jsonl`. */
export const STREAM_HEALTH_LOG = "stream-health.jsonl";

/**
 * THE HEALTH LOG (#2502): every health the stream side sends, about once a
 * second, a JSON line in the streamed Recording Session's folder, so a
 * stream that fails on the rig can be read back afterwards. Never in
 * `events.jsonl`: it is not the Recording Session's. Closed at the take's
 * stop, before anything may move the folder; a write that fails is said
 * once and costs the take nothing.
 */
export const openStreamHealthLog = (folder: string) => {
  const out = fs.createWriteStream(path.join(folder, STREAM_HEALTH_LOG), {
    flags: "a",
  });
  let failed = false;
  out.on("error", (e) => {
    if (failed) return;
    failed = true;
    console.error(`recorder: ${STREAM_HEALTH_LOG}: ${e.message}`);
  });
  return {
    write: (line: { atMs: number; fileTime: number } & StreamHealth) => {
      if (!failed && out.writable) out.write(`${JSON.stringify(line)}\n`);
    },
    close: () => void out.end(),
  };
};
