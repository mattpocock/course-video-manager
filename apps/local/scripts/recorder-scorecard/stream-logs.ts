import fs from "node:fs";
import path from "node:path";

/**
 * THE STREAMED TAKE'S FFMPEG LOGS, READ FOR ITS INPUTS (#2502): the
 * scorecard used to gate only what the stream encoded. On Matt's real take
 * the camera writer's log held 101 "FIFO queue full" lines and 92 failed
 * reconnects, and the stream's own log said "File ended prematurely", while
 * every gate would have passed. Its logs carry no times, so a fault's
 * stretch is marked by how long each file was when the fault began and when
 * it was over, and what was written in between is left out of every count:
 * an injected fault is meant to make these lines.
 */

/** A log and how many bytes of it were written at one moment. */
type Sizes = Record<string, number>;

/** One of the take's feeds overflowing its fifo: the stream fell behind it. */
export const FEED_OVERFLOW = /FIFO queue full/;

/** One of the stream's inputs reaching its end mid-take. */
export const INPUT_EOF = /File ended prematurely/;

/** An ffmpeg error, from any of them. */
export const FFMPEG_ERROR = /\[(error|fatal)\]/;

/** The Live Stream's own lines, as the service logs them. */
const STREAM_LINE = /recorder: Live Stream: /;

const sizeOf = (file: string) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

/**
 * The take's logs: the camera writer's and the screen recorder's (the
 * feeds' senders), the capture's, and the service's Live Stream lines (the
 * feeds' reader).
 */
export const streamedLogs = (sessionDir: string, serviceLog: string) => {
  const writers = ["camera", "screen", "capture"].map((name) =>
    path.join(sessionDir, `ffmpeg-${name}.log`)
  );
  const all = [...writers, serviceLog];
  const sizes = (): Sizes => Object.fromEntries(all.map((f) => [f, sizeOf(f)]));
  const start = sizes();
  const left: { from: Sizes; to?: Sizes }[] = [];

  /** Each file's text since the take began, less every fault's stretch. */
  const outside = (file: string) => {
    const text = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    const cuts = left
      .map((w) => [w.from[file] ?? 0, w.to?.[file] ?? text.length] as const)
      .sort((a, b) => a[0] - b[0]);
    let at = start[file] ?? 0;
    let kept = "";
    for (const [from, to] of cuts) {
      if (from > at) kept += text.subarray(at, from).toString();
      at = Math.max(at, to);
    }
    if (text.length > at) kept += text.subarray(at).toString();
    const lines = kept.split(/\r?\n/);
    return file === serviceLog
      ? lines.filter((l) => STREAM_LINE.test(l))
      : lines;
  };
  const matching = (files: readonly string[], pattern: RegExp) =>
    files.flatMap((f) =>
      outside(f)
        .filter((l) => pattern.test(l))
        .map((l) => `${path.basename(f)}: ${l.trim().slice(0, 300)}`)
    );

  return {
    /** A fault begins: what is logged from now until its `end` is left out. */
    fault: () => {
      const w: (typeof left)[number] = { from: sizes() };
      left.push(w);
      return { end: () => void (w.to = sizes()) };
    },
    /** Lines outside every fault, by what they say. */
    read: () => ({
      feedOverflows: matching(writers.slice(0, 2), FEED_OVERFLOW),
      inputEofs: matching([serviceLog], INPUT_EOF),
      errors: matching(all, FFMPEG_ERROR),
    }),
    /** Keeps every one of them in `dir`, whatever the run did with the footage. */
    keep: (dir: string) => {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of [
        ...writers,
        path.join(sessionDir, "stream-health.jsonl"),
        path.join(sessionDir, "events.jsonl"),
        serviceLog,
      ])
        if (fs.existsSync(f))
          fs.copyFileSync(f, path.join(dir, path.basename(f)));
    },
  };
};

export type StreamedLogs = ReturnType<typeof streamedLogs>;
