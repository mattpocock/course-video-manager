/**
 * Bounded accumulation of ffmpeg/ffprobe stderr text, and the formatting that
 * turns it into a useful error message.
 *
 * ffmpeg writes its diagnostic output — codec errors, encoder session
 * failures, filter graph problems — to stderr for as long as the process
 * runs, which for an export can be minutes. Capturing it verbatim risks
 * unbounded memory; keeping only the tail is enough for diagnosis, since the
 * bytes that matter on failure are almost always the last ones written
 * before the process died. The same bound keeps the per-video log line (see
 * VideoEditorLoggerService's "cli-output" event) from growing without limit
 * across a long-running encode.
 */
export const MAX_STDERR_TAIL_CHARS = 8_000;

export const appendBoundedTail = (
  previousTail: string,
  chunk: string,
  maxChars: number = MAX_STDERR_TAIL_CHARS
): string => {
  const combined = previousTail + chunk;
  return combined.length > maxChars
    ? combined.slice(combined.length - maxChars)
    : combined;
};

/**
 * Appends a captured stderr tail to an error message, or returns the message
 * unchanged when nothing was captured (e.g. the process never started).
 */
export const withStderrTail = (message: string, stderrTail: string): string =>
  stderrTail
    ? `${message}\n--- ffmpeg stderr (tail) ---\n${stderrTail}`
    : message;
