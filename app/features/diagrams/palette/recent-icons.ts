/**
 * The icon picker's most-recently-used list.
 *
 * Client-only and deliberately so: an Icon carries no record of its own — a
 * Diagram stores a name, and the table behind it is frozen — so there is nothing
 * server-side to hang a `lastUsedAt` off, the way a Component has one. The list
 * is a per-browser convenience, shared between the popup and the parent window
 * because they are the same origin.
 *
 * The list ops are pure and the storage boundary is one thin pair of functions,
 * so the ordering rules are testable without a DOM.
 */

const STORAGE_KEY = "diagram-palette:recent-icons";

/**
 * Two rows of the 10-column icon grid. Long enough that a working set survives,
 * short enough that the recents never push the alphabetical table off the first
 * screen entirely.
 */
export const RECENT_ICONS_LIMIT = 20;

/** The list after using `name` — most recent first, no duplicates, capped. */
export function pushRecentIcon(
  recent: readonly string[],
  name: string
): string[] {
  return [name, ...recent.filter((n) => n !== name)].slice(
    0,
    RECENT_ICONS_LIMIT
  );
}

/**
 * A stored list is untrusted input: it outlives this build, and anything at all
 * can be sitting under the key. Junk reads as "no history" rather than throwing,
 * because a broken recents list must never cost the author the icon picker.
 */
export function parseRecentIcons(raw: string | null): string[] {
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

export function readRecentIcons(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecentIcons(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage unavailable (private mode, blocked storage) — no history.
    return [];
  }
}

export function writeRecentIcons(recent: readonly string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // localStorage unavailable; the in-memory order still holds for the session.
  }
}
