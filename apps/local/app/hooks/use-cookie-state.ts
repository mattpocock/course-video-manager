import { useCallback, useState } from "react";

/**
 * Reads a single cookie value out of a `Cookie` request header. Intended for
 * use inside loaders so the server can render the correct initial UI state
 * (avoiding a hydration flicker that client-only storage would cause).
 */
export function readCookie(
  cookieHeader: string | null | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Like `useLocalStorage`, but backed by a cookie so the value is sent with
 * every request and can be read server-side. `serverValue` is the value the
 * loader read from the cookie, used as the initial state so server and client
 * render identically (no flicker).
 */
export function useCookieState(
  name: string,
  serverValue: string
): [string, (value: string) => void] {
  const [value, setValue] = useState(serverValue);

  const set = useCallback(
    (next: string) => {
      setValue(next);
      if (typeof document !== "undefined") {
        document.cookie = `${name}=${encodeURIComponent(
          next
        )}; path=/; max-age=31536000; samesite=lax`;
      }
    },
    [name]
  );

  return [value, set];
}
