import { describe, expect, it } from "vitest";
import { micEqCoefficients } from "@/packages/mic-eq";

/**
 * OBS's 3-Band Equaliser as obs-filters/eq-filter.c runs it, one sample at a
 * time, at 48 kHz: the reference the export's mic EQ must reproduce.
 */
const obsEq = (
  input: number[],
  lowDb: number,
  midDb: number,
  highDb: number
) => {
  const gain = (db: number) => 10 ** (db / 20);
  const lf = 2 * Math.sin((Math.PI * 800) / 48000);
  const hf = 2 * Math.sin((Math.PI * 5000) / 48000);
  const f1 = [0, 0, 0, 0];
  const f2 = [0, 0, 0, 0];
  const sdm = [0, 0, 0];
  return input.map((sample) => {
    const step = (f: number[], c: number) => {
      f[0]! += c * (sample - f[0]!);
      for (let i = 1; i < 4; i++) f[i]! += c * (f[i - 1]! - f[i]!);
    };
    step(f1, lf);
    step(f2, hf);
    const l = f1[3]!;
    const h = sdm[2]! - f2[3]!;
    const m = sdm[2]! - (h + l);
    sdm.unshift(sample);
    sdm.pop();
    return l * gain(lowDb) + m * gain(midDb) + h * gain(highDb);
  });
};

/** Run a transfer function (`num`/`den` in z⁻¹, den[0] = 1) as aiir r=d does. */
const directForm = (input: number[], num: number[], den: number[]) => {
  const y: number[] = [];
  input.forEach((_, n) => {
    let acc = 0;
    num.forEach((b, i) => n - i >= 0 && (acc += b * input[n - i]!));
    den.forEach((a, i) => i > 0 && n - i >= 0 && (acc -= a * y[n - i]!));
    y.push(acc);
  });
  return y;
};

describe("micEqCoefficients", () => {
  it("filters the mic sample for sample as OBS's 3-Band Equaliser does", () => {
    let seed = 1;
    const noise = Array.from({ length: 4800 }, () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    });
    for (const [low, mid, high] of [
      [0, 0, -6.1],
      [3, -2, -6.1],
      [-4, 0, 0],
      [-3, -3, -3],
    ] as const) {
      const { num, den } = micEqCoefficients({
        lowDb: low,
        midDb: mid,
        highDb: high,
      });
      const ours = directForm(noise, num, den);
      const theirs = obsEq(noise, low, mid, high);
      const worst = Math.max(...ours.map((v, i) => Math.abs(v - theirs[i]!)));
      expect(worst).toBeLessThan(1e-9);
    }
  });
});
