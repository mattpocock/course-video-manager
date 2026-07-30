/**
 * The icon picker's most-recently-used list.
 *
 * Client-only and deliberately so: an Icon carries no record of its own — a
 * Diagram stores a name, and the table behind it is frozen — so there is nothing
 * server-side to hang a `lastUsedAt` off, the way a Component has one.
 *
 * `localStorage` is the source of truth rather than a cache of React state:
 * `recordIconUse` re-reads before it writes, so a list that moved on since this
 * window read it is extended, not overwritten.
 */

const STORAGE_KEY = "diagram-palette:recent-icons";

/**
 * Two rows of the 10-column icon grid. Long enough that a working set survives,
 * short enough that the recents never push the alphabetical table off the first
 * screen entirely.
 */
export const RECENT_ICONS_LIMIT = 20;

/** The stored list, most recent first. `[]` whenever there is nothing usable. */
export function readRecentIcons(): string[] {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // No `window`, or storage blocked (private mode) — no history.
    return [];
  }
}

/** Records `name` as just used, and returns the list that produces. */
export function recordIconUse(name: string): string[] {
  const next = [name, ...readRecentIcons().filter((n) => n !== name)].slice(
    0,
    RECENT_ICONS_LIMIT
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable; the returned order still holds for this session.
  }
  return next;
}

/**
 * A stored list is untrusted input: it outlives this build, and anything at all
 * can be sitting under the key. Junk reads as "no history" rather than throwing,
 * because a broken recents list must never cost the author the icon picker.
 */
function parse(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((n): n is string => typeof n === "string")
    .slice(0, RECENT_ICONS_LIMIT);
}
