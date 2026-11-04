/**
 * The one way a duration reads on screen: `m:ss`, and `h:mm:ss` once it
 * reaches an hour — a Video's length, a timecode, an Animatic's run time, a
 * YouTube chapter. Seconds are floored, so a label never claims a second the
 * media doesn't have yet.
 *
 * `scripts/check-duration-format.sh` fails hand-rolled `m:ss` formatting
 * anywhere else, so every duration grows its hours field the same way.
 */
export function formatDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * A rounded total, not a timecode: `1h 3m` from an hour, else `42m` (`0m` for
 * nothing). Minutes are floored. For running totals where seconds are noise,
 * such as the footage filmed this week at the foot of the sidebar.
 */
export function formatHoursMinutes(totalSeconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - hours * 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * A running clock, every field always there: `HH:MM:SS` (`00:04:07`,
 * `27:00:01`), so it never changes width as it counts. For the Live Timer.
 * Seconds are floored; nothing below zero.
 */
export function formatRunningClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(whole / 3600))}:${two(Math.floor((whole % 3600) / 60))}:${two(whole % 60)}`;
}
