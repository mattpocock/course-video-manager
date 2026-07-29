/**
 * Ten words of matched text around the first hit, with ellipses.
 *
 * Lives here rather than in a route because two surfaces show it — the
 * Playground Home search results and the command palette's "Go to diagram"
 * page — and search has to mean the same thing in both.
 */
export function makeSnippet(searchText: string | null, query: string): string {
  if (!searchText) return "";
  const words = searchText.split(/\s+/);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const idx = words.findIndex((w) =>
    terms.some((t) => w.toLowerCase().includes(t))
  );
  const start = Math.max(0, idx > 0 ? idx - 3 : 0);
  const slice = words.slice(start, start + 10);
  return (
    (start > 0 ? "… " : "") +
    slice.join(" ") +
    (start + 10 < words.length ? " …" : "")
  );
}
