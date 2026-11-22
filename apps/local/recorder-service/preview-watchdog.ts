import { lineSplitter, type LaunchedProcess } from "./launcher";
import { PREVIEW_STALL_MS } from "./protocol";

/**
 * THE PREVIEW WATCHDOG (#2192). A preview ffmpeg.exe can stall while still
 * running (a Short's screen preview stopped sending at 75 s and only a
 * restart of `pnpm dev` brought it back), and the browser kept showing its
 * last frame. So each preview process is watched: no frame for
 * `PREVIEW_STALL_MS` (a longer wait for its first) and it is stalled, and
 * its owner restarts it. Its stderr goes into the service's log (a preview
 * logs warnings and errors only), a few lines a minute at most.
 *
 * A preview process holds no device and writes no Footage (#2207), so
 * restarting one never touches a take. The camera's owner restarts the
 * camera capture too only while no take runs (`camera.ts`).
 */

/** A new preview gets this long for its first frame (ddagrab, a 4K dshow open, x264). */
const FIRST_FRAME_FACTOR = 3;

/** Lines of a preview's stderr logged per minute, at most. */
const STDERR_LINES_PER_MINUTE = 20;

/**
 * Logs `p`'s stderr and calls `onStall` (once) when frames stop. Stops
 * watching when it exits or the returned stop is called.
 */
export const watchPreview = (o: {
  /** What the log calls it: "screen preview", "camera preview". */
  name: string;
  process: LaunchedProcess;
  /** Subscribes to the frames the process sends; returns the unsubscribe. */
  onFrame: (listener: () => void) => () => void;
  onStall: () => void;
  stallMs?: number;
}) => {
  const stallMs = o.stallMs ?? PREVIEW_STALL_MS;
  let lastFrameMs = Date.now();
  let seen = false;
  let logged = 0;
  let windowStart = Date.now();
  o.process.onStderr(
    lineSplitter((line) => {
      if (!line.trim()) return;
      if (Date.now() - windowStart > 60_000) {
        windowStart = Date.now();
        logged = 0;
      }
      logged += 1;
      if (logged <= STDERR_LINES_PER_MINUTE)
        console.error(`recorder: ${o.name}: ${line}`);
      else if (logged === STDERR_LINES_PER_MINUTE + 1)
        console.error(`recorder: ${o.name}: (more lines this minute left out)`);
    })
  );
  const unsubscribe = o.onFrame(() => {
    lastFrameMs = Date.now();
    seen = true;
  });
  const timer = setInterval(
    () => {
      const limit = seen ? stallMs : stallMs * FIRST_FRAME_FACTOR;
      if (Date.now() - lastFrameMs <= limit) return;
      stop();
      o.onStall();
    },
    Math.max(20, Math.min(500, stallMs / 4))
  );
  const stop = () => {
    clearInterval(timer);
    unsubscribe();
  };
  void o.process.exited.then(stop);
  return stop;
};
