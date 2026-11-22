import { Clock, Duration, Effect } from "effect";

/**
 * A clock the test moves by hand, so pauses are measured in its time, not
 * the wall clock's. `whenAsleep` resolves once the chat waits on it.
 */
export const handClock = () => {
  let now = Date.now();
  const sleepers: { at: number; wake: () => void }[] = [];
  let asleep: (() => void) | null = null;
  const clock: Clock.Clock = {
    [Clock.ClockTypeId]: Clock.ClockTypeId,
    unsafeCurrentTimeMillis: () => now,
    currentTimeMillis: Effect.sync(() => now),
    unsafeCurrentTimeNanos: () => BigInt(now) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    sleep: (duration) =>
      Effect.async<void>((resume) => {
        const sleeper = {
          at: now + Duration.toMillis(duration),
          wake: () => resume(Effect.void),
        };
        sleepers.push(sleeper);
        asleep?.();
        return Effect.sync(() => {
          sleepers.splice(sleepers.indexOf(sleeper), 1);
        });
      }),
  };
  return {
    clock,
    now: () => now,
    /** Resolves once something sleeps on this clock. */
    whenAsleep: () =>
      sleepers.length > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            asleep = () => {
              asleep = null;
              resolve();
            };
          }),
    /** Moves time on to the next sleeper's wake-up, and wakes it. */
    wakeNext: () => {
      sleepers.sort((a, b) => a.at - b.at);
      const next = sleepers.shift()!;
      now = Math.max(now, next.at);
      next.wake();
    },
  };
};
