import { describe, expect, it } from "vitest";
import { formatLoad, parseLoadLine, wslCpu } from "./load-sampler";

describe("load-sampler", () => {
  it("reads a sampler line, the GPU columns optional", () => {
    expect(parseLoadLine("87\t6.1\t0.98\t45\t12\t30\r")).toEqual({
      cpuPct: 87,
      capturePct: 6.1,
      captureCores: 0.98,
      gpuPct: 45,
      encoderPct: 12,
      decoderPct: 30,
    });
    expect(parseLoadLine("40\t2.0\t0.32\t\t\t")).toMatchObject({
      gpuPct: null,
      encoderPct: null,
      decoderPct: null,
    });
    expect(parseLoadLine("timeBeginPeriod(1) in ffmpeg.exe 42")).toBe(
      undefined
    );
  });

  it("writes one line per sample", () => {
    expect(
      formatLoad(Date.UTC(2026, 9, 15, 13, 2, 31), {
        cpuPct: 87.4,
        capturePct: 6.1,
        captureCores: 0.98,
        gpuPct: 45,
        encoderPct: null,
        decoderPct: 30,
        wslPct: 52.6,
      })
    ).toBe(
      "[load] 2026-10-15T13:02:31.000Z cpu 87% capture 6.1% (0.98 cores) wsl 53% gpu 45% enc ? dec 30%"
    );
  });

  it("measures WSL's CPU between two reads of /proc/stat, idle and iowait not busy", () => {
    const stats = [
      "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3\n",
      "cpu  200 0 200 1300 300 0 0 0 0 0\n",
    ];
    const read = wslCpu(() => stats.shift() ?? "");
    expect(read()).toBe(null);
    // busy +200 of total +1000
    expect(read()).toBe(20);
    expect(read()).toBe(null);
  });
});
