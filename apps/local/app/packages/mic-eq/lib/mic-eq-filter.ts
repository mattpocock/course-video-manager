import type { MicEq } from "@cvm/core/features/videos/recorder";

/** The mic's sample rate, which {@link micEqCoefficients} are computed for. */
const MIC_EQ_SAMPLE_RATE = 48000;

/** A polynomial in z⁻¹, lowest power first. */
type Poly = readonly number[];

const polyMul = (a: Poly, b: Poly): number[] => {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j]! += x * y)));
  return out;
};

const polyAdd = (a: Poly, b: Poly): number[] =>
  Array.from(
    { length: Math.max(a.length, b.length) },
    (_, i) => (a[i] ?? 0) + (b[i] ?? 0)
  );

const polyScale = (a: Poly, k: number): number[] => a.map((x) => x * k);

/**
 * OBS's 4-pole low-pass at `freq`: four one-poles `y += c·(x − y)` in a row,
 * `c = 2·sin(π·freq/rate)`. Its numerator is the constant `c⁴`.
 */
const obsLowPass = (freq: number): { gain: number; den: number[] } => {
  const c = 2 * Math.sin((Math.PI * freq) / MIC_EQ_SAMPLE_RATE);
  let den: number[] = [1];
  for (let i = 0; i < 4; i++) den = polyMul(den, [1, -(1 - c)]);
  return { gain: c ** 4, den };
};

const dbToGain = (db: number) => 10 ** (db / 20);

/**
 * OBS's 3-Band Equaliser (`basic_eq_filter`, obs-filters/eq-filter.c) as one
 * transfer function. OBS splits the mic with two 4-pole low-passes, at
 * 800 Hz and 5 kHz: low = LP800, high = x(n−3) − LP5k, mid = x(n−3) − low −
 * high, each times its band's gain. Summed, that is
 *
 *   H(z) = g_high·z⁻³ + (g_low − g_mid)·LP800 + (g_mid − g_high)·LP5k
 *
 * The 5 kHz low-pass is gentle (−3 dB near 2 kHz), so OBS's "high band" cuts
 * from well below 5 kHz; a 5 kHz shelf only reaches about −3.7 dB of a −6.1 dB
 * ask over speech. A band equal to the mid drops its low-pass term.
 */
export const micEqCoefficients = (
  eq: MicEq
): { num: number[]; den: number[] } => {
  const [low, mid, high] = [eq.lowDb, eq.midDb, eq.highDb].map(dbToGain) as [
    number,
    number,
    number,
  ];
  const terms = [
    ...(eq.lowDb !== eq.midDb ? [{ k: low - mid, lp: obsLowPass(800) }] : []),
    ...(eq.highDb !== eq.midDb
      ? [{ k: mid - high, lp: obsLowPass(5000) }]
      : []),
  ];
  // Over the common denominator, each term's numerator is its gain times the
  // other terms' denominators.
  const den = terms.reduce<number[]>((d, t) => polyMul(d, t.lp.den), [1]);
  const num = terms.reduce(
    (n, t, i) =>
      polyAdd(
        n,
        polyScale(
          terms.reduce<number[]>(
            (rest, u, j) => (j === i ? rest : polyMul(rest, u.lp.den)),
            [1]
          ),
          t.k * t.lp.gain
        )
      ),
    polyMul([0, 0, 0, high], den)
  );
  return { num, den };
};

/**
 * The mic EQ as ffmpeg filters: OBS's 3-Band Equaliser, sample for sample
 * ({@link micEqCoefficients}), in double precision. A flat EQ adds none.
 */
export const micEqFilters = (eq: MicEq): string[] => {
  if (eq.lowDb === 0 && eq.midDb === 0 && eq.highDb === 0) return [];
  const { num, den } = micEqCoefficients(eq);
  const list = (p: number[]) => p.map((c) => c.toPrecision(17)).join(" ");
  return [
    `aresample=${MIC_EQ_SAMPLE_RATE}`,
    `aiir=z=${list(num)}:p=${list(den)}:k=1:f=tf:r=d:e=dbl:n=0`,
  ];
};
