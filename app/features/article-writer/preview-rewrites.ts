/**
 * The one mechanism for showing the preview something other than what is
 * stored.
 *
 * `react-markdown` parses HTML, not JSX, so every JSX-style tag the writer
 * emits — a screenshot placeholder, a quiz — is swapped for a plain lowercase
 * tag before parsing. Each swap shifts every offset after it, and the preview's
 * remove buttons report offsets, so the shifts have to be reversible. Holding
 * all swaps in one list is what makes that possible: a second, independent
 * preprocessor would silently corrupt the first one's arithmetic.
 */

/** A span of source replaced by something else before the preview parses it. */
export interface PreviewRewrite {
  start: number;
  end: number;
  replacement: string;
}

/** Applies every rewrite, innermost details untouched. Order does not matter. */
export function applyPreviewRewrites(
  source: string,
  rewrites: PreviewRewrite[]
): string {
  const ordered = [...rewrites].sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const rewrite of ordered) {
    if (rewrite.start < at) continue; // overlapping — first one wins
    out += source.slice(at, rewrite.start) + rewrite.replacement;
    at = rewrite.end;
  }
  return out + source.slice(at);
}

/**
 * Translates an offset in the rewritten document back to the source.
 *
 * `inside` marks an offset that lands within a replacement rather than after
 * it. Such an offset has no honest source position — the whole replaced span is
 * one indivisible thing — so a caller wanting to cut text must refuse.
 */
export function mapPreviewOffset(
  rewrites: PreviewRewrite[],
  offset: number
): { source: number; inside: boolean } {
  const ordered = [...rewrites].sort((a, b) => a.start - b.start);
  let shift = 0;
  for (const rewrite of ordered) {
    const renderedStart = rewrite.start + shift;
    const renderedEnd = renderedStart + rewrite.replacement.length;
    if (renderedEnd > offset) {
      return { source: offset - shift, inside: renderedStart <= offset };
    }
    shift += rewrite.replacement.length - (rewrite.end - rewrite.start);
  }
  return { source: offset - shift, inside: false };
}
