/**
 * Render an unknown failure as one string a human can read in a log file.
 *
 * Export failures arrive as tagged errors that wrap other errors: a
 * `OverlayContentRenderError` holds the subprocess failure, which holds the
 * spawn error. `String(cause)` shows only the outermost layer, and
 * `JSON.stringify` shows `{}` for anything extending `Error`, so both throw
 * away the one line that says what actually went wrong. This walks the chain
 * instead.
 *
 * It never throws. A formatter that fails while explaining a failure replaces
 * the information it exists to preserve.
 */
export const formatFailureCause = (
  cause: unknown,
  depth: number = 0
): string => {
  // Deep enough. A cycle (an error whose cause is itself) would otherwise
  // recurse until the stack gives out, inside error handling, where a second
  // failure is hardest to read.
  if (depth > 4) return "…";

  try {
    if (cause instanceof Error) {
      const head = cause.stack ?? `${cause.name}: ${cause.message}`;
      // `cause` is standard on Error and is also where Effect's tagged errors
      // put the thing they wrapped.
      const inner = (cause as { cause?: unknown }).cause;
      if (inner === undefined || inner === null) return head;
      return `${head}\ncaused by: ${formatFailureCause(inner, depth + 1)}`;
    }

    if (typeof cause === "string") return cause;

    // Effect's `Cause` and plain objects both land here. `JSON.stringify`
    // returns undefined for a function or a bare symbol, hence the fallback.
    return JSON.stringify(cause, null, 2) ?? String(cause);
  } catch {
    // A getter that throws, a BigInt, a circular plain object.
    return "[unformattable cause]";
  }
};
