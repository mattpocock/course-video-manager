import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option } from "effect";
import type { SidecarOutcome } from "./sidecar";

/**
 * Keep the sidecar running: a run that ends for any reason but a signal or
 * another sidecar holding the lease runs again. The wait is `initialDelayMs`
 * after a run that was up (it held the lease, or stayed `healthyAfterMs`),
 * and doubles with each run in a row that could not start (1 s, 2 s, 4 s …
 * up to `maxDelayMs`).
 *
 * A database outage longer than the outage tolerance (`lease lapsed`) used to end the
 * process with exit 0, and nothing started it again: every Job waited in the
 * queue, silently, until someone restarted `pnpm dev`. So did a database
 * that was unreachable when the sidecar started.
 */
export interface SuperviseOptions<E, R> {
  /** One run, stopped early when `stop` completes. */
  readonly runOnce: (
    stop: Deferred.Deferred<string>
  ) => Effect.Effect<SidecarOutcome, E, R>;
  /** Completed by SIGINT / SIGTERM: stop the run, and run no more. */
  readonly signalled: Deferred.Deferred<string>;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly healthyAfterMs: number;
  /** Said before each wait, with why the run ended. */
  readonly onRestart: (restart: {
    readonly delayMs: number;
    readonly why: string;
  }) => Effect.Effect<void>;
}

/** How supervision ended. */
export type SupervisedOutcome =
  | { readonly _tag: "Signalled"; readonly signal: string }
  | Extract<SidecarOutcome, { _tag: "LeaseHeld" }>;

export const superviseSidecar = <E, R>(
  opts: SuperviseOptions<E, R>
): Effect.Effect<SupervisedOutcome, never, R> =>
  Effect.gen(function* () {
    let delayMs = opts.initialDelayMs;
    while (true) {
      const stop = yield* Deferred.make<string>();
      const relay = yield* Effect.fork(
        Deferred.await(opts.signalled).pipe(
          Effect.flatMap((signal) => Deferred.succeed(stop, signal))
        )
      );
      const startedAt = yield* Clock.currentTimeMillis;
      const exit = yield* Effect.exit(opts.runOnce(stop));
      yield* Fiber.interrupt(relay);

      const signal = yield* Deferred.poll(opts.signalled);
      if (Option.isSome(signal)) {
        return { _tag: "Signalled", signal: yield* signal.value } as const;
      }
      let why: string;
      if (Exit.isSuccess(exit)) {
        if (exit.value._tag === "LeaseHeld") return exit.value;
        why = `it stopped: ${exit.value.reason}`;
      } else {
        why = `it failed:\n${Cause.pretty(exit.cause, { renderErrorCause: true })}`;
      }

      const ranMs = (yield* Clock.currentTimeMillis) - startedAt;
      if (Exit.isSuccess(exit) || ranMs >= opts.healthyAfterMs) {
        delayMs = opts.initialDelayMs;
      }
      yield* opts.onRestart({ delayMs, why });
      const signalledMeanwhile = yield* Deferred.await(opts.signalled).pipe(
        Effect.timeoutOption(delayMs)
      );
      if (Option.isSome(signalledMeanwhile)) {
        return { _tag: "Signalled", signal: signalledMeanwhile.value } as const;
      }
      delayMs = Math.min(delayMs * 2, opts.maxDelayMs);
    }
  });
