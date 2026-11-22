/**
 * Decides what the hub prints when a client connects.
 *
 * The hub used to print a bare `Client connected` per connection. That is fine
 * for the handful of connects a normal filming session makes, and useless the
 * moment one page churns its socket: the terminal fills with identical lines
 * that name neither the page at fault nor how many clients are actually there.
 *
 * So: the first connect from an origin prints in full, and further connects
 * from the same origin inside {@link WINDOW_MS} are counted and reported as one
 * summary line per window, which says plainly that the page is churning.
 *
 * Pure and clock-injected so the churn path can be tested without waiting.
 */

/** How long an origin stays "recently seen" for collapsing purposes. */
export const WINDOW_MS = 10_000;

/** Connects from one origin inside a window before we call it churn. */
export const CHURN_THRESHOLD = 3;

export type ConnectionLog = {
  /** The line to print, or `null` when this connect is being collapsed. */
  onConnect: (params: {
    origin: string | undefined;
    clientCount: number;
  }) => string | null;
};

export function createConnectionLog(
  now: () => number = Date.now
): ConnectionLog {
  // Per origin: when the window opened, how many connects it has seen, and
  // whether we have already printed a summary for the current window.
  const windows = new Map<
    string,
    { openedAt: number; connects: number; reported: boolean }
  >();

  return {
    onConnect: ({ origin, clientCount }) => {
      const key = origin ?? "unknown origin";
      const at = now();
      const seen = windows.get(key);

      if (!seen || at - seen.openedAt > WINDOW_MS) {
        windows.set(key, { openedAt: at, connects: 1, reported: false });
        return `Client connected — ${clientCount} client(s) — ${key}`;
      }

      seen.connects += 1;
      if (seen.connects < CHURN_THRESHOLD || seen.reported) return null;

      seen.reported = true;
      const seconds = Math.round(WINDOW_MS / 1000);
      return `${key} reconnected ${seen.connects}x in under ${seconds}s — that page is churning its hub socket; further connects from it are collapsed (${clientCount} client(s))`;
    },
  };
}
