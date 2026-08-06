import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

export function useLocalStorage(
  key: string,
  fallback = ""
): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(key);
      if (stored !== null) return stored;
    }
    return fallback;
  });

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
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
