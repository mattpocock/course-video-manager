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

export function useLocalStorage(
  key: string,
  fallback = ""
): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState(() => {
    if (hasLocalStorage()) {
      const stored = localStorage.getItem(key);
      if (stored !== null) return stored;
    }
    return fallback;
  });

  useEffect(() => {
    if (hasLocalStorage()) {
      localStorage.setItem(key, value);
    }
  }, [key, value]);

  return [value, setValue];
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
