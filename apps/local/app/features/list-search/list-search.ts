/**
 * IN-PAGE SEARCH (#2512): the search box on the Pitches, Standalone Videos
 * and Shorts pages. It filters the rows the page's loader already returned,
 * with the shared matching rule (`matchesSearchQuery`), so the box and
 * `cvm search` agree on what "matches" means. The query lives in the URL
 * (`?q=`), so a reload, Back or a link keeps it, and a navigation that only
 * changed it loads nothing again. Pure: the pages apply it while rendering.
 */
import { matchesSearchQuery } from "@cvm/core/lib/search-match";

export const SEARCH_PARAM = "q";

/** The query as typed, or "" when the URL has none. */
export const searchQueryOf = (params: URLSearchParams): string =>
  params.get(SEARCH_PARAM) ?? "";

/** Whether the box holds a query, so the page shows search results. */
export const isSearching = (query: string): boolean => query.trim() !== "";

/** The params with the query as typed, or without `q` once it is empty. */
export const withSearchQuery = (
  params: URLSearchParams,
  query: string
): URLSearchParams => {
  const next = new URLSearchParams(params);
  if (query === "") next.delete(SEARCH_PARAM);
  else next.set(SEARCH_PARAM, query);
  return next;
};

/** Whether two URLs differ only in the query: nothing to load again. */
export const onlySearchChanged = (current: URL, next: URL): boolean => {
  if (current.pathname !== next.pathname) return false;
  const rest = (url: URL) => {
    const params = new URLSearchParams(url.search);
    params.delete(SEARCH_PARAM);
    params.sort();
    return params.toString();
  };
  return (
    rest(current) === rest(next) &&
    searchQueryOf(current.searchParams) !== searchQueryOf(next.searchParams)
  );
};

/** The Pitches whose title or description matches. */
export const searchPitches = <T extends { title: string; description: string }>(
  pitches: readonly T[],
  query: string
): T[] =>
  pitches.filter(
    (p) =>
      matchesSearchQuery(p.title, query) ||
      matchesSearchQuery(p.description, query)
  );

/** The Standalone Videos or Shorts whose title matches. */
export const searchVideos = <T extends { title: string }>(
  videos: readonly T[],
  query: string
): T[] => videos.filter((v) => matchesSearchQuery(v.title, query));
