/**
 * Incremental parser for ffmpeg's `-progress pipe:1` output.
 *
 * ffmpeg writes repeating key=value blocks (roughly every 500ms) terminated by
 * a `progress=continue|end` line. The only key we need is `out_time_us` — the
 * output timestamp in microseconds — which, divided by the expected output
 * duration, yields a percentage. (`out_time_ms` is accepted as a fallback; due
 * to a long-standing ffmpeg quirk it is *also* in microseconds.)
 *
 * Emission contract, shared with every consumer up the stack (exportVideoClips
 * → SSE → upload reducer):
 * - integer percents only, emitted only when the value changes (so a phase
 *   emits at most ~100 events);
 * - clamped to 0–99 — 100 is reserved for the caller's own completion signal;
 * - monotonic: a percent lower than one already emitted is dropped.
 */
export const createFfmpegProgressParser = (opts: {
  totalDurationSeconds: number;
  onPercent: (percent: number) => void;
}) => {
  let leftover = "";
  let lastPercent = -1;

  const handleLine = (line: string) => {
    const eq = line.indexOf("=");
    if (eq === -1) return;
    const key = line.slice(0, eq);
    if (key !== "out_time_us" && key !== "out_time_ms") return;
    const value = Number(line.slice(eq + 1));
    if (!Number.isFinite(value)) return;

    const outTimeSeconds = Math.max(0, value / 1_000_000);
    const percent = Math.min(
      99,
      Math.floor((outTimeSeconds / opts.totalDurationSeconds) * 100)
    );
    if (percent > lastPercent) {
      lastPercent = percent;
      opts.onPercent(percent);
    }
  };

  const push = (chunk: string) => {
    if (opts.totalDurationSeconds <= 0) return;
    leftover += chunk;
    const lines = leftover.split("\n");
    // The final element is an incomplete line (or "") — keep it for next push.
    leftover = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line);
    }
  };

  return { push };
};
