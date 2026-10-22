import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Queue,
  Schedule,
  type Scope,
} from "effect";
import {
  JobOperationsService,
  type Job,
  type JobFailure,
  type SidecarLease,
} from "@cvm/core/services/db-job-operations.server";
import { formatFailureCause } from "@/services/format-failure-cause";
import { storageRootOfflineErrorOf } from "@/packages/storage";
import { readStorageRootsOrNone } from "@/services/storage-roots";
import {
  isNeverReRun,
  isPostingKind,
  isResumable,
  resumableKindsOf,
  interruptedFailureOf,
  neverReRunMessagesOf,
  type JobContext,
} from "./job-kind";
import { makeKindCleanup } from "./kind-cleanup";
import { settleCancelled } from "./settle-cancelled";
import { retryingSettleOps } from "./settle-retry";
import { makePostChecks } from "./post-checks";
import { makeJobEventFeed, type JobEventFeed } from "./job-event-feed";
import {
  enqueueThrough,
  UnknownJobKindError,
  type JobKindRegistry,
} from "./job-kinds";
import { LANE_NAMES, LANES, laneHasRoom, type LaneName } from "./lanes";

/**
 * THE SIDECAR: the one process that runs background Jobs for a database.
 *
 * It holds the database's single `sidecar_lease`, claims Jobs lane by lane,
 * runs each Job's handler in its own fiber, heartbeats every running Job's
 * lease, and settles each attempt by the retry rule in `db-job-operations`. A
 * Job whose sidecar died is settled the same way by the next recovery sweep.
 *
 * NO FAILURE LEAVES WITHOUT A LOG LINE. Every handler's exit — success,
 * failure, defect or interruption — goes through `settle`, which logs it
 * (with the whole cause) before it touches the row, and every loop logs its
 * own failures and carries on. A handler never has to remember to log.
 */

export { SIDECAR_TIMING, type SidecarTiming } from "./sidecar-timing";
import type { SidecarTiming } from "./sidecar-timing";

export { POST_CHECK_EVENT } from "./post-checks";

export interface SidecarIdentity {
  /** Fresh per process. */
  readonly holder: string;
  readonly pid: number;
  readonly hostname: string;
  readonly checkout: string;
  readonly gitSha: string;
  readonly socket: string;
}

export interface SidecarHealth {
  readonly ok: true;
  readonly holder: string;
  readonly pid: number;
  readonly checkout: string;
  readonly gitSha: string;
  readonly socket: string;
  readonly database: string;
  readonly startedAt: string;
  readonly lanes: Record<
    LaneName,
    { readonly concurrency: number | "unbounded"; readonly running: number }
  >;
}

/** What the socket can ask of a running sidecar. */
export interface SidecarHandle {
  readonly health: Effect.Effect<SidecarHealth>;
  /** Look for work (and new Job Events) now rather than at the next poll. */
  readonly nudge: Effect.Effect<void>;
  /** Every new Job Event, for the `/events` stream. */
  readonly feed: JobEventFeed;
}

export type SidecarOutcome =
  | { readonly _tag: "Stopped"; readonly reason: string }
  | { readonly _tag: "LeaseHeld"; readonly lease: SidecarLease | undefined };

/** A Job's failure as `job.error` keeps it: tag, one line, and the whole chain. */
export const toJobFailure = (
  cause: Cause.Cause<unknown>,
  roots: readonly string[] = []
): JobFailure => {
  const squashed = Cause.squash(cause);
  // A Job that needs an Offline Storage Root fails saying which drive, not
  // with the filesystem's ENODEV.
  const error = storageRootOfflineErrorOf(squashed, roots) ?? squashed;
  const tag =
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string"
      ? error._tag
      : null;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : String(error);
  return { tag, message, cause: formatFailureCause(squashed) };
};

const logCause = (what: string) =>
  Effect.catchAllCause((cause: Cause.Cause<unknown>) =>
    Effect.logError(what, cause)
  );

export const runSidecar = <R>(opts: {
  readonly identity: SidecarIdentity;
  /** `R`: the services the kinds' handlers need, provided with the call. */
  readonly registry: JobKindRegistry<R>;
  readonly timing: SidecarTiming;
  /** Completed by whoever wants the sidecar to stop (a signal); the reason is logged. */
  readonly stop: Deferred.Deferred<string>;
  /**
   * Housekeeping run after each recovery sweep (at start, then every
   * `recoverEveryMs`): run-sidecar passes the stuck-Clip sweep
   * (`stuck-clip-sweep.ts`). Its failures are logged; it never stops the
   * sidecar.
   */
  readonly afterRecovery?: Effect.Effect<void, unknown, R>;
  /** Starts the socket once the lease is held; it is closed first on the way out. */
  readonly serve: (
    handle: SidecarHandle
  ) => Effect.Effect<void, unknown, Scope.Scope | JobOperationsService>;
}): Effect.Effect<SidecarOutcome, unknown, JobOperationsService | R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const { identity, registry, timing, stop } = opts;
      // Settling writes retry through a DB blip (#2168).
      const ops = retryingSettleOps(
        yield* JobOperationsService,
        timing.jobLeaseMs
      );

      // -- The lease ---------------------------------------------------------
      const take = ops.acquireSidecarLease({
        holder: identity.holder,
        pid: identity.pid,
        hostname: identity.hostname,
        checkout: identity.checkout,
        gitSha: identity.gitSha,
        socket: identity.socket,
        leaseMs: timing.leaseMs,
      });
      let taken = yield* take;
      if (!taken.acquired) {
        // A sidecar that was killed without letting go (SIGKILL, a crash)
        // leaves a lease that lapses in `leaseMs`. Wait that out; a lease
        // still renewed after it belongs to a live sidecar.
        yield* Effect.logWarning(
          "sidecar: another sidecar holds this database's lease; waiting for it to lapse",
          taken.lease
        );
        const deadline = Date.now() + timing.lapseWaitMs;
        while (!taken.acquired && Date.now() < deadline) {
          yield* Effect.sleep(Math.min(1_000, timing.leaseMs));
          taken = yield* take;
        }
        if (!taken.acquired) {
          return { _tag: "LeaseHeld", lease: taken.lease } as const;
        }
      }
      const database = taken.lease.database;
      yield* Effect.addFinalizer(() =>
        ops
          .releaseSidecarLease(identity.holder)
          .pipe(
            Effect.zipRight(Effect.logInfo("sidecar: lease released")),
            logCause(
              "sidecar: could not release the lease; it lapses on its own"
            )
          )
      );
      yield* Effect.logInfo("sidecar: lease acquired", {
        database,
        checkout: identity.checkout,
        gitSha: identity.gitSha,
        pid: identity.pid,
      });
      const startedAt = new Date().toISOString();

      // -- Waking the lanes --------------------------------------------------
      const wake = new Map<LaneName, Queue.Queue<void>>();
      for (const lane of LANE_NAMES) {
        wake.set(lane, yield* Queue.sliding<void>(1));
      }
      const queues = [...wake.values()];
      const feed = yield* makeJobEventFeed({
        pollMs: timing.pollMs,
        pageSize: 500,
      });
      const nudge = Effect.forEach(
        queues,
        (queue) => Queue.offer(queue, undefined),
        { discard: true }
      ).pipe(Effect.zipRight(feed.wake));

      // -- Running one Job ---------------------------------------------------
      /** Set once the sidecar has been told to stop, before it interrupts its Jobs. */
      let stopping = false;
      const running = new Map<
        string,
        { readonly lane: LaneName; readonly fiber: Fiber.RuntimeFiber<void> }
      >();
      const runningIn = (lane: LaneName) =>
        [...running.values()].filter((r) => r.lane === lane).length;

      const kindOf = (name: string) =>
        Object.hasOwn(registry, name) ? registry[name] : undefined;

      const enqueue = enqueueThrough({ registry, ops, then: nudge });

      const { afterLostRun, afterFinalFailure, afterRecovered, endedForGood } =
        makeKindCleanup({ kindOf, enqueue });

      const settle = (job: Job, exit: Exit.Exit<void, unknown>) =>
        Exit.match(exit, {
          onSuccess: () =>
            ops
              .completeJob({ jobId: job.id, holder: identity.holder })
              .pipe(
                Effect.flatMap((held) =>
                  held
                    ? Effect.logInfo("job succeeded")
                    : Effect.logWarning(
                        "job finished, but this sidecar no longer held it"
                      )
                )
              ),
          onFailure: (cause) => {
            const cancelled = settleCancelled({
              ops,
              jobId: job.id,
              holder: identity.holder,
              cause,
            });
            if (cancelled) return cancelled;
            const interrupted = Cause.isInterruptedOnly(cause);
            const posting = isPostingKind(kindOf(job.kind));
            const neverReRun = isNeverReRun(kindOf(job.kind));
            // A stop on purpose (a signal: `tsx watch` restarting after an
            // edit, Ctrl-C, verify-cvm's cleanup) is not the Job failing, so
            // it costs no attempt: the Job goes back to the queue as it was.
            // A sidecar that dies instead is settled by recovery, which does
            // spend one (a resumable kind's does not, #2167).
            // A POST is never put back (decision 5): it may already have gone
            // out, so it ends `interrupted` and waits for the author's Retry.
            // Nor is a Publish (section 7.2): cut off after Submit, it leaves a
            // Pending Version only the author may Promote or Discard.
            if (interrupted && stopping && !neverReRun) {
              return Effect.logWarning(
                "job interrupted: the sidecar is stopping; it goes back to the queue at the same attempt"
              ).pipe(
                Effect.zipRight(
                  ops.returnJobToQueue({
                    jobId: job.id,
                    holder: identity.holder,
                    reason: "the sidecar stopped",
                  })
                ),
                Effect.flatMap((held) =>
                  Effect.logInfo(
                    `job settled: ${held ? "requeued" : "not-held"}`
                  )
                )
              );
            }
            const failure = interrupted
              ? interruptedFailureOf(kindOf(job.kind))
              : toJobFailure(cause, readStorageRootsOrNone());
            return (
              interrupted
                ? Effect.logWarning(
                    posting
                      ? "job interrupted: a post is never run again on its own; it waits for the author's Retry"
                      : "job interrupted"
                  )
                : Effect.logError("job failed", cause)
            ).pipe(
              Effect.zipRight(
                ops.failJobAttempt({
                  jobId: job.id,
                  holder: identity.holder,
                  failure,
                  interrupted,
                  // Never put back: never re-run by a lost lease either.
                  mayRetry: !posting && !(neverReRun && interrupted),
                  resumable: isResumable(kindOf(job.kind)),
                })
              ),
              Effect.flatMap((outcome) =>
                Effect.logInfo(`job settled: ${outcome}`).pipe(
                  // Interrupted while not stopping: this sidecar lost the
                  // Job's lease mid-run, so whoever took it settled it — and
                  // ran `afterLostRun` then (`not-held` here). Only the run
                  // that settles a lost run cleans up after it, once. A
                  // handler that failed cleaned up itself. A post cut off
                  // either way is looked for at its service.
                  Effect.zipRight(
                    interrupted && !stopping && outcome !== "not-held"
                      ? afterLostRun(job)
                      : Effect.void
                  ),
                  Effect.zipRight(
                    endedForGood(outcome)
                      ? afterFinalFailure(job, failure.message)
                      : Effect.void
                  )
                )
              ),
              Effect.zipRight(
                interrupted && posting && !stopping ? checkPosts : Effect.void
              )
            );
          },
        }).pipe(
          logCause(
            "job: could not record how it ended; its lease will lapse and recovery will settle it"
          )
        );

      const runJob = (
        job: Job,
        lane: LaneName,
        registered: Deferred.Deferred<void>
      ) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            yield* Deferred.await(registered);
            const kind = Object.hasOwn(registry, job.kind)
              ? registry[job.kind]
              : undefined;
            const ctx: JobContext = {
              jobId: job.id,
              attempt: job.attempt,
              maxAttempts: job.maxAttempts,
              emit: (type, data) =>
                ops
                  .appendJobEvent({ jobId: job.id, type, data })
                  .pipe(
                    Effect.zipRight(feed.wake),
                    logCause("job: could not record an event")
                  ),
              enqueue,
            };
            yield* Effect.logInfo("job started", {
              title: job.title,
              lane,
              maxAttempts: job.maxAttempts,
            });
            const work = kind
              ? kind.runRaw(job.params, ctx)
              : Effect.fail(
                  new UnknownJobKindError({
                    kind: job.kind,
                    message: `no such job kind: ${job.kind}`,
                  })
                );
            const exit = yield* Effect.exit(restore(work));
            yield* settle(job, exit);
          })
        ).pipe(
          Effect.annotateLogs({
            jobId: job.id,
            kind: job.kind,
            attempt: job.attempt,
            subject: job.subjectType
              ? `${job.subjectType}:${job.subjectId ?? ""}`
              : null,
          }),
          Effect.ensuring(
            Effect.suspend(() => {
              running.delete(job.id);
              return nudge;
            })
          )
        );

      // -- The lanes ---------------------------------------------------------
      const fillLane = (lane: LaneName) =>
        Effect.gen(function* () {
          while (laneHasRoom(lane, runningIn(lane))) {
            const job = yield* ops.claimNextJob({
              lane,
              holder: identity.holder,
              leaseMs: timing.jobLeaseMs,
            });
            if (!job) return;
            const registered = yield* Deferred.make<void>();
            const fiber = yield* Effect.forkScoped(
              runJob(job, lane, registered)
            );
            running.set(job.id, { lane, fiber });
            yield* Deferred.succeed(registered, undefined);
          }
        });

      const laneLoop = (lane: LaneName) => {
        const queue = wake.get(lane);
        if (!queue) return Effect.void;
        return Effect.forever(
          fillLane(lane).pipe(
            logCause(`sidecar: lane ${lane} could not claim work`),
            Effect.zipRight(
              Queue.take(queue).pipe(Effect.timeoutOption(timing.pollMs))
            )
          )
        );
      };

      // -- Recovery, heartbeats, the lease's renewal --------------------------
      // -- Interrupted posts: did they go out? (`post-checks.ts`) ------------
      const postChecks = yield* makePostChecks({
        registry,
        timeoutMs: timing.postCheckTimeoutMs,
        wake: feed.wake,
      });
      const checkPosts = postChecks.sweep;

      const recover = Effect.suspend(() =>
        // The Jobs running in this sidecar right now, read at each sweep.
        ops.recoverExpiredJobs({
          neverRetryKinds: neverReRunMessagesOf(registry),
          resumableKinds: resumableKindsOf(registry),
          stillRunning: [...running.keys()],
        })
      ).pipe(
        Effect.flatMap((recovered) =>
          Effect.forEach(
            recovered,
            (r) =>
              Effect.logWarning(`job recovered: ${r.outcome}`).pipe(
                Effect.annotateLogs({ jobId: r.jobId }),
                Effect.zipRight(
                  ops.getJob(r.jobId).pipe(
                    Effect.flatMap((job) =>
                      job ? afterRecovered(job, r.outcome) : Effect.void
                    ),
                    logCause("sidecar: could not read a recovered job")
                  )
                )
              ),
            { discard: true }
          )
        ),
        logCause("sidecar: the recovery sweep failed"),
        Effect.zipRight(
          (opts.afterRecovery ?? Effect.void).pipe(
            logCause("sidecar: the after-recovery sweep failed")
          )
        )
      );

      const heartbeat = Effect.gen(function* () {
        const ids = [...running.keys()];
        if (ids.length === 0) return;
        const held = new Set(
          yield* ops.heartbeatJobs({
            holder: identity.holder,
            jobIds: ids,
            leaseMs: timing.jobLeaseMs,
          })
        );
        for (const id of ids) {
          const entry = running.get(id);
          if (held.has(id) || !entry) continue;
          yield* Effect.logWarning(
            "job: this sidecar lost the job's lease; stopping it"
          ).pipe(Effect.annotateLogs({ jobId: id }));
          yield* Fiber.interruptFork(entry.fiber);
        }
      }).pipe(logCause("sidecar: the job heartbeat failed"));

      // A sidecar that cannot reach its database for longer than the lease
      // has lost it — another may hold it by now — so it stops rather than run
      // Jobs on a lease it cannot prove.
      let lastRenewed = Date.now();
      const renewLease = ops
        .renewSidecarLease({
          holder: identity.holder,
          leaseMs: timing.leaseMs,
        })
        .pipe(
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
                Date.now() - lastRenewed > timing.leaseMs
                  ? Effect.logError(
                      "sidecar: the lease lapsed while the database was unreachable; stopping"
                    ).pipe(
                      Effect.zipRight(Deferred.succeed(stop, "lease lapsed"))
                    )
                  : Effect.void
              )
            )
          )
        );

      // Recovery runs once before any lane claims, so a Job the last sidecar
      // left running is settled before new work starts beside it.
      yield* recover;

      yield* opts.serve({
        health: Effect.sync(() => ({
          ok: true as const,
          holder: identity.holder,
          pid: identity.pid,
          checkout: identity.checkout,
          gitSha: identity.gitSha,
          socket: identity.socket,
          database,
          startedAt,
          lanes: Object.fromEntries(
            LANE_NAMES.map((lane) => [
              lane,
              {
                concurrency: LANES[lane].concurrency,
                running: runningIn(lane),
              },
            ])
          ) as SidecarHealth["lanes"],
        })),
        nudge,
        feed,
      });

      yield* Effect.forkScoped(
        Effect.repeat(renewLease, Schedule.spaced(timing.leaseRenewMs))
      );
      yield* Effect.forkScoped(
        Effect.repeat(heartbeat, Schedule.spaced(timing.jobHeartbeatMs))
      );
      // Recovery may have just ended a post `interrupted`: look for it, in
      // the background, so a slow service never holds up the lanes.
      yield* Effect.forkScoped(checkPosts);
      yield* Effect.forkScoped(
        Effect.repeat(
          Effect.sleep(timing.recoverEveryMs).pipe(
            Effect.zipRight(recover),
            Effect.zipRight(checkPosts)
          ),
          Schedule.forever
        )
      );
      const lanes = yield* Effect.forkScoped(
        Effect.forEach(LANE_NAMES, laneLoop, {
          concurrency: "unbounded",
          discard: true,
        })
      );
      yield* Effect.logInfo("sidecar: running", {
        lanes: Object.fromEntries(
          LANE_NAMES.map((lane) => [lane, LANES[lane].concurrency])
        ),
        socket: identity.socket,
      });

      const reason = yield* Deferred.await(stop);
      yield* Effect.logInfo(`sidecar: stopping (${reason})`);
      stopping = true;
      // Stop claiming first, then stop every running Job: each settles as an
      // interrupted attempt — back to `queued` while it has attempts left.
      yield* Fiber.interrupt(lanes);
      yield* Fiber.interruptAll([...running.values()].map((r) => r.fiber));
      return { _tag: "Stopped", reason } as const;
    })
  );
