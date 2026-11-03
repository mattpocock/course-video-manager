import { Deferred, Effect } from "effect";
import type { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { SidecarTiming } from "./sidecar-timing";

/**
 * One renewal of the Sidecar's lease, run every `leaseRenewMs` (#2621).
 *
 * - Renewed: the clock starts again.
 * - Answered `false`: another sidecar holds the lease (the renewal matches on
 *   `holder` alone), so stop at once.
 * - No answer: proves nothing. The lease may have lapsed with nobody taking
 *   it, and the first renewal after the outage takes it back. So run on, and
 *   stop only once the database has been silent for `outageToleranceMs`.
 *   Other sidecars wait that long past a Job's lease before they recover it
 *   (`recoverExpiredJobs`'s `holderGoneAfterMs`), so this one must really
 *   stop by then. A renewal that hangs (a black-holed connect) is given up
 *   after `leaseMs` and counts as no answer.
 */
export const makeLeaseRenewal = (opts: {
  readonly ops: Pick<JobOperationsService, "renewSidecarLease">;
  readonly holder: string;
  readonly timing: SidecarTiming;
  readonly stop: Deferred.Deferred<string>;
}): Effect.Effect<void> => {
  const { ops, holder, timing, stop } = opts;
  let lastRenewed = Date.now();
  return ops.renewSidecarLease({ holder, leaseMs: timing.leaseMs }).pipe(
    Effect.timeoutFail({
      duration: timing.leaseMs,
      onTimeout: () =>
        new Error(`the lease renewal had no answer in ${timing.leaseMs} ms`),
    }),
    Effect.flatMap((renewed) =>
      renewed
        ? Effect.sync(() => {
            lastRenewed = Date.now();
          })
        : Effect.logError(
            "sidecar: another sidecar took this database's lease; stopping"
          ).pipe(Effect.zipRight(Deferred.succeed(stop, "lease lost")))
    ),
    Effect.catchAllCause((cause) =>
      Effect.logError("sidecar: could not renew the lease", cause).pipe(
        Effect.zipRight(
          Date.now() - lastRenewed > timing.outageToleranceMs
            ? Effect.logError(
                "sidecar: the database has been unreachable for longer than the outage tolerance; stopping"
              ).pipe(Effect.zipRight(Deferred.succeed(stop, "lease lapsed")))
            : Effect.void
        )
      )
    ),
    Effect.asVoid
  );
};
