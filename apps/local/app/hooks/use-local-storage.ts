import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
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
function hasLocalStorage(): boolean {
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
