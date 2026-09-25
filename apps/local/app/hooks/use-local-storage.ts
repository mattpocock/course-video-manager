import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Guards every `localStorage` access on the server. `typeof localStorage !==
 * "undefined"` alone isn't enough: Node now ships a global `localStorage`
 * stub (Web Storage API, unflagged since Node 22) whose methods throw
 * "is not a function" unless the process was started with
 * `--localstorage-file`. SSR (`renderToStaticMarkup` et al) never sets that
 * flag, so this also checks that `getItem` actually exists before use.
 */
export function hasLocalStorage(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    typeof localStorage.getItem === "function" &&
    typeof localStorage.setItem === "function"
  );
}

/** The stored string, or `null` when there is nothing readable under `key`. */
function readStored(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes, and says nothing when it cannot. A write throws on a full quota and
 * in a browser that blocks storage outright (private mode); neither is worth
 * taking a render down for, because the in-memory value still serves the
 * session.
 */
function writeStored(key: string, value: string): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked; the in-memory value still holds for this session.
  }
}

/**
 * Which value a render shows, given the one the hook is holding. The same key
 * keeps the held value — an unsaved edit must survive a re-render — and a new
 * key reads that key's own stored value instead.
 *
 * This is the whole reason the hook tracks the key alongside the value: a
 * component that stays mounted while its key changes (the posting pages, keyed
 * per `videoId`) would otherwise keep the previous video's value on screen and
 * then auto-save it over the new video's draft.
 */
export function valueForKey(
  held: { key: string; value: string },
  key: string,
  fallback: string
): { key: string; value: string } {
  if (held.key === key) return held;
  return { key, value: readStored(key) ?? fallback };
}

export function useLocalStorage(
  key: string,
  fallback = ""
): [string, Dispatch<SetStateAction<string>>] {
  const [held, setHeld] = useState(() => ({
    key,
    value: readStored(key) ?? fallback,
  }));

  // Adjusting state during render, rather than in an effect, so a key change
  // never paints one frame of the previous key's value.
  const current = valueForKey(held, key, fallback);
  if (current !== held) setHeld(current);

  useEffect(() => {
    writeStored(key, current.value);
  }, [key, current.value]);

  const setValue: Dispatch<SetStateAction<string>> = useCallback(
    (action) => {
      setHeld((prev) => ({
        key: prev.key,
        value: typeof action === "function" ? action(prev.value) : action,
      }));
    },
    []
  );

  return [current.value, setValue];
}

export function useLocalStorageBoolean(
  key: string,
  fallback: boolean = false
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [raw, setRaw] = useLocalStorage(key, String(fallback));

  const value = raw === "true";

  const setValue: Dispatch<SetStateAction<boolean>> = useCallback(
    (action) => {
      setRaw((prev) => {
        const next =
          typeof action === "function" ? action(prev === "true") : action;
        return String(next);
      });
    },
    [setRaw]
  );

  return [value, setValue];
}

/** A stored id list that survives a bad or hand-edited value. */
export function parseStringSet(raw: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

/**
 * A set of ids kept in `localStorage` as a JSON array — the Set-shaped sibling
 * of {@link useLocalStorageBoolean}, for preferences that name *which* items
 * are on rather than one on/off.
 */
export function useLocalStorageStringSet(
  key: string
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [raw, setRaw] = useLocalStorage(key, "[]");

  const value = useMemo(() => parseStringSet(raw), [raw]);

  const setValue: Dispatch<SetStateAction<Set<string>>> = useCallback(
    (action) => {
      setRaw((prev) => {
        const next =
          typeof action === "function" ? action(parseStringSet(prev)) : action;
        return JSON.stringify([...next]);
      });
    },
    [setRaw]
  );

  return [value, setValue];
}

/**
 * A preference that is one of a fixed set of spellings — the enum-shaped
 * sibling of {@link useLocalStorageBoolean}. A stored value outside the set
 * (hand-edited, or written by an older build that named the positions
 * differently) falls back rather than throwing, in the same spirit as
 * {@link parseStringSet}.
 *
 * Unlike the hooks above it writes on set rather than in an effect, and it
 * re-reads whenever the key changes. Both matter for a preference kept PER
 * SUBJECT — one key per Course, say: an effect that wrote the current value
 * whenever the key changed would copy one subject's setting onto the next one
 * the moment the page switched between them.
 */
export function useLocalStorageOneOf<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): [T, (next: T) => void] {
  const read = useCallback(
    (from: string): T => {
      if (!hasLocalStorage()) return fallback;
      const stored = localStorage.getItem(from) ?? "";
      return (allowed as readonly string[]).includes(stored)
        ? (stored as T)
        : fallback;
    },
    [allowed, fallback]
  );

  const [value, setValue] = useState(() => read(key));

  const readFrom = useRef(key);
  if (readFrom.current !== key) {
    readFrom.current = key;
    setValue(read(key));
  }

  const set = useCallback(
    (next: T) => {
      setValue(next);
      if (hasLocalStorage()) localStorage.setItem(key, next);
    },
    [key]
  );

  return [value, set];
}
