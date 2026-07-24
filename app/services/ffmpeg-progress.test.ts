import { describe, expect, it } from "vitest";
import { createFfmpegProgressParser } from "./ffmpeg-progress";

const block = (outTimeUs: number, progress: "continue" | "end" = "continue") =>
  [
    "frame=100",
    "fps=50.0",
    `out_time_us=${outTimeUs}`,
    `out_time_ms=${outTimeUs}`,
    "out_time=00:00:00.000000",
    "speed=2.5x",
    `progress=${progress}`,
    "",
  ].join("\n");

describe("createFfmpegProgressParser", () => {
  const collect = (totalDurationSeconds: number) => {
    const percents: number[] = [];
    const parser = createFfmpegProgressParser({
      totalDurationSeconds,
      onPercent: (p) => percents.push(p),
    });
    return { percents, parser };
  };

  it("emits integer percent from out_time_us against the total duration", () => {
    const { percents, parser } = collect(10);
    parser.push(block(2_500_000));
    expect(percents).toEqual([25]);
  });

  it("only emits when the integer percent changes", () => {
    const { percents, parser } = collect(100);
    parser.push(block(1_000_000));
    parser.push(block(1_400_000));
    parser.push(block(1_900_000));
    parser.push(block(2_000_000));
    expect(percents).toEqual([1, 2]);
  });

  it("handles blocks split across arbitrary chunk boundaries", () => {
    const { percents, parser } = collect(10);
    const text = block(5_000_000);
    // Split mid-key and mid-value
    parser.push(text.slice(0, 25));
    parser.push(text.slice(25, 60));
    parser.push(text.slice(60));
    expect(percents).toEqual([50]);
  });

  it("clamps to 99 even when out_time overshoots the estimate", () => {
    const { percents, parser } = collect(10);
    parser.push(block(9_900_000));
    parser.push(block(12_000_000));
    parser.push(block(15_000_000, "end"));
    expect(percents).toEqual([99]);
  });

  it("never goes backwards", () => {
    const { percents, parser } = collect(10);
    parser.push(block(5_000_000));
    parser.push(block(4_000_000));
    parser.push(block(6_000_000));
    expect(percents).toEqual([50, 60]);
  });

  it("ignores N/A values", () => {
    const { percents, parser } = collect(10);
    parser.push("out_time_us=N/A\nprogress=continue\n");
    expect(percents).toEqual([]);
  });

  it("falls back to out_time_ms (which ffmpeg also emits in microseconds)", () => {
    const { percents, parser } = collect(10);
    parser.push("out_time_ms=2500000\nprogress=continue\n");
    expect(percents).toEqual([25]);
  });

  it("emits nothing for a non-positive total duration", () => {
    const { percents, parser } = collect(0);
    parser.push(block(5_000_000));
    expect(percents).toEqual([]);
  });

  it("floors negative out_time to zero and emits it once", () => {
    const { percents, parser } = collect(10);
    // ffmpeg can report a small negative out_time before the first frame lands
    parser.push("out_time_us=-125000\nprogress=continue\n");
    parser.push(block(1_000_000));
    expect(percents).toEqual([0, 10]);
  });
});
