/**
 * The Imported Footage page's URL for the hit being played: the params that
 * pick it, and whether a navigation changed only them. Kept out of the
 * page's reducer, as `_app.tsx` reads it too.
 */

/** The URL params that pick the hit being played. */
export const PLAY_PARAM = "play";
export const TIME_PARAM = "t";

/** The page's URL with this hit playing, keeping the search. */
export const withPlayer = (
  params: URLSearchParams,
  path: string,
  start: number
): string => {
  const next = new URLSearchParams(params);
  next.set(PLAY_PARAM, path);
  next.set(TIME_PARAM, String(start));
  return `?${next.toString()}`;
};

/** Whether two URLs differ only in the hit being played: nothing to load. */
export const onlyPlayerChanged = (current: URL, next: URL): boolean => {
  if (current.pathname !== next.pathname) return false;
  const rest = (url: URL) => {
    const params = new URLSearchParams(url.search);
    params.delete(PLAY_PARAM);
    params.delete(TIME_PARAM);
    params.sort();
    return params.toString();
  };
  return rest(current) === rest(next) && current.search !== next.search;
};
