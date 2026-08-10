// Matches the auto-generated default short title from
// `_app.shorts._index.tsx` (`Short ${new Date().toLocaleDateString()}`),
// e.g. "Short 7/16/2026".
const DEFAULT_SHORT_TITLE_RE = /^Short \d{1,2}\/\d{1,2}\/\d{4}$/;

export function isDefaultShortTitle(title: string): boolean {
  return DEFAULT_SHORT_TITLE_RE.test(title);
}
