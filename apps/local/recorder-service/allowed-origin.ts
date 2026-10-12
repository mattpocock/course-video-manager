/**
 * WHO MAY USE THE RECORDER SERVICE. Its WebSocket opens the Cam Link and its
 * HTTP port serves the camera's pictures, so a web page from anywhere else
 * must get neither. The app server's WebSocket client sends no Origin; the
 * browser's pages are CVM's own, on loopback: 5173 (dev and start) and
 * 5200-5299 (verify-cvm runs, see vite.config.ts).
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isCvmOrigin = (origin: string) => {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const port = Number(url.port);
  return (
    url.protocol === "http:" &&
    LOOPBACK.has(url.hostname) &&
    (port === 5173 || (port >= 5200 && port <= 5299))
  );
};

/** A request with no Origin (not from a page) or one from CVM's own page. */
export const isAllowedOrigin = (origin: string | undefined) =>
  origin === undefined || isCvmOrigin(origin);

/**
 * The CORS headers for a response to this Origin: CVM's own page is echoed
 * back so it can draw the pictures on a canvas; no Origin gets none.
 */
export const corsHeaders = (origin: string | undefined) =>
  ({
    Vary: "Origin",
    ...(origin && isCvmOrigin(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
  }) as Record<string, string>;
