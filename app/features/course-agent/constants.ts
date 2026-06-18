export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}K`;
}

export const CONTEXT_WINDOW = 200_000;
