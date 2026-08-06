import { DatabaseIcon, DatabaseZapIcon } from "lucide-react";
import type { WriterCacheStats } from "./types";

const formatTokens = (tokens: number): string => {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
};

/**
 * The prompt cache's only visible symptom.
 *
 * A cache miss raises no error — Anthropic silently bills the full prefix —
 * so without this the breakpoints could rot for months unnoticed. The headline
 * is deliberately binary, because the daily question is "did that hit?"; the
 * three raw counts sit in the hover text for when the answer is no.
 */
export function CacheStatsBadge(props: { stats: WriterCacheStats }) {
  const { cacheReadTokens, cacheWriteTokens, noCacheTokens } = props.stats;

  // A write with no read is the expected first request of a session, not a
  // fault — so it reads as "warmed" rather than as a miss.
  const isHit = cacheReadTokens > 0;
  const isWarming = !isHit && cacheWriteTokens > 0;

  const label = isHit
    ? `cached ${formatTokens(cacheReadTokens)}`
    : isWarming
      ? `warmed ${formatTokens(cacheWriteTokens)}`
      : "uncached";

  const title = [
    `Read from cache: ${cacheReadTokens.toLocaleString()}`,
    `Written to cache: ${cacheWriteTokens.toLocaleString()}`,
    `Full price: ${noCacheTokens.toLocaleString()}`,
  ].join("\n");

  const Icon = isHit ? DatabaseZapIcon : DatabaseIcon;

  return (
    <div
      title={title}
      className={`mt-1 inline-flex items-center gap-1 text-xs ${
        isHit
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground"
      }`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </div>
  );
}
