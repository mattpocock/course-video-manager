import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
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
