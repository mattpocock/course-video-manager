import type { FramesLost, LostFrameSpan } from "./protocol";

/**
 * FRAMES LOST in one Recording Session (#2214): the Cam Link's dshow buffer
 * drops, any gap in the frames reaching the writer (the Cam Link skipping,
 * or the relay dropping what the writer could not take), and any gap in
 * ddagrab's frames reaching the screen recorder. The CFR filters fill each
 * gap with repeats, so each is a freeze in the file.
 *
 * Every loss is told (`tell`) so the editor can alert mid-take: the first at
 * once, a burst after it (dshow drops come in runs) at most once per
 * `FRAMES_LOST_PERIOD_MS`, with the latest totals and every span lost so
 * far, in picture time (#2227). The editor alerts only for spans inside a
 * Clip; the totals count every loss, in or out of one.
 */

/** How often, at most, a burst of lost frames is told. */
export const FRAMES_LOST_PERIOD_MS = 500;

/** The Cam Link's frame rate: how many frames a gap the writer logs was. */
export const CAMERA_FPS = 30000 / 1001;

/** The screen recorder's frame rate, for the same. */
const SCREEN_FPS = 60;

/** A gap the writer or screen recorder logged, in seconds (`gapLogger`). */
const GAP = /\[warning\] -(\d+(?:\.\d+)?)\s*$/;

/** The file time of the frame before that gap, logged just before it. */
const GAP_FROM = /\[warning\] (\d+(?:\.\d+)?)\s*$/;

/**
 * Losses of one picture this close (seconds) are one span: a run of dshow
 * drops, or a stutter of gaps, is one freeze to Matt, and the list stays
 * short however bad a take gets.
 */
export const LOST_SPAN_MERGE_SECONDS = 1;

/** A dshow drop from the Cam Link's real-time buffer (not the mic's). */
const CAMERA_BUFFER_DROP = /real-time buffer .*\[video input\].*frame dropped/;

/** Frames missing in a gap of `seconds` at `fps`. */
const missingIn = (seconds: string, fps: number) =>
  Math.max(1, Math.round(Number(seconds) * fps) - 1);

export const countFramesLost = (o: {
  /** False for a camera-only Short: its screen's are null, not 0. */
  screenCaptured: boolean;
  /** The take's file time now, for the log line. */
  fileTime: () => number;
  /**
   * The picture time now by the clock: where a dshow drop, which has no
   * frame time, is stamped.
   */
  pictureTime: () => number;
  /** Tells the totals and spans so far. */
  tell: (lost: FramesLost, lostFrameSpans: LostFrameSpan[]) => void;
}) => {
  let cameraBufferDrops = 0;
  let cameraGapFrames = 0;
  let screenGapFrames = 0;
  let stopped = false;
  let lastToldMs = -Infinity;
  let tellLater: ReturnType<typeof setTimeout> | undefined;
  const spans: LostFrameSpan[] = [];
  /** Each picture's gap start, logged on the line before its gap. */
  const gapFrom: Record<LostFrameSpan["picture"], number | null> = {
    camera: null,
    screen: null,
  };

  const addSpan = (span: LostFrameSpan) => {
    const near = spans.findLast((s) => s.picture === span.picture);
    if (
      near &&
      span.from <= near.to + LOST_SPAN_MERGE_SECONDS &&
      span.to >= near.from - LOST_SPAN_MERGE_SECONDS
    ) {
      near.from = Math.min(near.from, span.from);
      near.to = Math.max(near.to, span.to);
      near.frames += span.frames;
      return;
    }
    spans.push({ ...span });
  };
  const spansSoFar = () => spans.map((s) => ({ ...s }));

  const totals = (): FramesLost => ({
    camera: cameraBufferDrops + cameraGapFrames,
    screen: o.screenCaptured ? screenGapFrames : null,
  });

  const lost = () => {
    if (stopped || tellLater) return;
    const tell = () => {
      tellLater = undefined;
      if (stopped) return;
      lastToldMs = Date.now();
      o.tell(totals(), spansSoFar());
    };
    const wait = lastToldMs + FRAMES_LOST_PERIOD_MS - Date.now();
    if (wait <= 0) tell();
    else tellLater = setTimeout(tell, wait);
  };

  /**
   * Frames missing in a gap line from `picture`'s file, its span noted; 0
   * for a gap's start line (noted for the gap after it); null for any other
   * line.
   */
  const gapLine = (
    line: string,
    picture: LostFrameSpan["picture"],
    fps: number,
    where: string
  ): number | null => {
    const from = line.match(GAP_FROM);
    if (from) {
      gapFrom[picture] = Number(from[1]);
      return 0;
    }
    const gap = line.match(GAP);
    if (!gap) return null;
    const missing = missingIn(gap[1]!, fps);
    const seconds = Number(gap[1]);
    // A writer from before the start line: the gap ended about now.
    const start = gapFrom[picture] ?? Math.max(0, o.fileTime() - seconds);
    gapFrom[picture] = null;
    // To the microsecond ffmpeg prints, not a float's tail.
    const to = Math.round((start + seconds) * 1e6) / 1e6;
    addSpan({ picture, from: start, to, frames: missing });
    console.error(
      `recorder: ${picture}.mkv is missing about ${missing} frame(s) at ${start.toFixed(2)} s: a ${gap[1]} s gap in ${where}`
    );
    return missing;
  };

  return {
    /** A line the camera capture printed. */
    captureLine: (line: string) => {
      if (!CAMERA_BUFFER_DROP.test(line)) return;
      cameraBufferDrops += 1;
      const at = Math.max(0, o.pictureTime());
      addSpan({ picture: "camera", from: at, to: at, frames: 1 });
      lost();
    },
    /** A line the writer printed: true when it was a gap or its start (and nothing else). */
    writerLine: (line: string): boolean => {
      const missing = gapLine(
        line,
        "camera",
        CAMERA_FPS,
        "the Cam Link's frames reaching the writer"
      );
      if (missing === null) return false;
      if (missing === 0) return true;
      cameraGapFrames += missing;
      lost();
      return true;
    },
    /** A line the screen recorder printed. */
    screenLine: (line: string) => {
      const missing = gapLine(
        line,
        "screen",
        SCREEN_FPS,
        "the screen's frames"
      );
      if (!missing) return;
      screenGapFrames += missing;
      lost();
    },
    /** Stops telling; `recording-stopped` reports the final totals. */
    stop: () => {
      stopped = true;
      clearTimeout(tellLater);
    },
    totals,
    /** Every span lost, told or not: `recording-stopped`'s. */
    spans: spansSoFar,
  };
};
