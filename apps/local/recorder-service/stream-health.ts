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

/** One process's part of the health: all but the reconnect count. */
export type ProcessHealth = Omit<StreamHealth, "reconnects">;

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

  const blockEnded = () => {
    const b = block;
    block = {};
    o.onBlock(numberOf(b.frame) ?? 0);
    const us = numberOf(b.out_time_us);
    const at = us === null ? null : us / 1e6;
    const since = at === null || lastAt === undefined ? null : at - lastAt;
    if (since !== null && since < HEALTH_PERIOD_S) return;
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
