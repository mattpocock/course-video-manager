// Shared numbers for the verdict rules (judge.ts, judge-sync.ts): the sync
// limit and the small statistics both use.

export const LIMIT_MS = 33;
/** One camera frame at 29.97 fps: how far the CFR saw-tooth may move the camera's offset. */
export const CAMERA_FRAME_MS = 1000 / (30000 / 1001);

export const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

export function stats(a: number[]) {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return {
    avg: s.reduce((x, y) => x + y, 0) / s.length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: s[s.length - 1]!,
    n: s.length,
  };
}

export const r1 = (x: number) => Math.round(x * 10) / 10;
