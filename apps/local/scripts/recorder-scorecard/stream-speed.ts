import type { MetricDef } from "./metric-def";
import type { Span } from "./stream-sink";

/**
 * THE LIVE STREAM KEEPING UP (#2631): ffmpeg's `speed` in the stream health
 * the service sends about once a second. On 2026-11-03 Local Whisper held the
 * GPU at 100% through a stream, and its speed read 0.10-0.63 against a clean
 * ~0.99, with 24-38 fps, 11 feed overflows and two relaunches. Under
 * {@link LOW_STREAM_SPEED} the encoder is falling behind real time.
 */
export const LOW_STREAM_SPEED = 0.9;

export type SpeedSample = { at: number; speed: number | null };

/**
 * The longest stretch, in seconds, that the health inside any of `spans`
 * read a speed under {@link LOW_STREAM_SPEED}: from its first low health to
 * the first back up (or the span's last health). Health with no speed is
 * no evidence either way. Null when no health in the spans has a speed.
 */
export const longestLowSpeedS = (
  samples: readonly SpeedSample[],
  spans: readonly Span[]
): number | null => {
  let measured = false;
  let longest = 0;
  for (const [from, to] of spans) {
    const inSpan = samples.filter(
      (s): s is { at: number; speed: number } =>
        s.speed !== null && s.at >= from && s.at <= to
    );
    let lowSince: number | null = null;
    for (const s of inSpan) {
      measured = true;
      if (s.speed < LOW_STREAM_SPEED) {
        lowSince ??= s.at;
        longest = Math.max(longest, s.at - lowSince);
      } else if (lowSince !== null) {
        longest = Math.max(longest, s.at - lowSince);
        lowSince = null;
      }
    }
  }
  return measured ? longest / 1000 : null;
};

/** Its metric, after the stream's frame rate in `metrics.ts`. */
export const STREAM_SPEED_METRICS: readonly MetricDef[] = [
  {
    id: "stream_low_speed_max_s",
    label:
      "Longest the Live Stream's encode ran under 0.9x real time (its health's speed), once steady and outside the faults",
    group: "reliability",
    unit: "s",
    better: "lower",
    target: 5,
    obs: null,
    scale: 1,
    note: "#2631: on 2026-11-03 Local Whisper held the GPU through a stream and its speed read 0.10-0.63 (clean ~0.99). Read over the same steady spans as the frame rate (the first process from 20 s after live to its kill, the relaunched one from 5 s after live to the feed cut), from the first health under 0.9 to the first back up (`stream-speed.ts`).",
  },
];
