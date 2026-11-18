import { Effect } from "effect";
import {
  JobOperationsService,
  type Job,
} from "@cvm/core/services/db-job-operations.server";

/**
 * The one loop every `cvm` verb that waits on a Sidecar Job runs: read the
 * Job every `pollMs` until it settles, and say once on STDERR if it is still
 * queued with no Sidecar running. `cvm short render`, `cvm footage
 * transcribe`, `cvm course publish --wait`, `cvm video post-youtube --wait`
 * and `cvm job wait` all follow their Jobs through it; each decides for
 * itself what a settled Job means.
 *
 * A failed attempt that has attempts left goes back to `queued`, so only the
 * Job's last word counts: this returns at `succeeded`, `failed`,
 * `interrupted` or `cancelled`, and `null` when the Job is gone (never
 * enqueued, or deleted).
 */
export type SettledJob = Job & {
  readonly status: "succeeded" | "failed" | "interrupted" | "cancelled";
};

const isSettled = (job: Job): job is SettledJob =>
  job.status !== "queued" && job.status !== "running";

/** What the STDERR line says, for a Job that waits on a Sidecar that is down. */
export const noSidecarLine = (what: string) => ({
  event: "waiting",
  message: `the sidecar is not running: ${what} starts when it does (\`pnpm dev\` or \`pnpm start\` runs it)`,
});

export const followJob = <E = never, R = never>(input: {
  readonly jobId: string;
  readonly pollMs: number;
  /** What starts once a Sidecar runs, for the waiting line: "the render". */
  readonly what: string;
  /** A line for STDERR: only ever that the Sidecar is not running. */
  readonly onWaiting: (line: Record<string, unknown>) => Effect.Effect<void>;
  /** Run on every read, before the Job is judged: a Publish prints its events here. */
  readonly onPoll?: () => Effect.Effect<void, E, R>;
}) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    let warnedNoSidecar = false;
    while (true) {
      const job = yield* ops.getJob(input.jobId);
      if (input.onPoll) yield* input.onPoll();
      if (!job) return null;
      if (isSettled(job)) return job;
      if (job.status === "queued" && !warnedNoSidecar) {
        const lease = yield* ops.getSidecarLease();
        if (!lease || lease.leaseUntil.getTime() < Date.now()) {
          warnedNoSidecar = true;
          yield* input.onWaiting(noSidecarLine(input.what));
        }
      }
      yield* Effect.sleep(input.pollMs);
    }
  }).pipe(Effect.withSpan("followJob"));

/** What a failed Job recorded (`job.error`): its tag and its one line. */
export const jobFailureOf = (
  job: Pick<Job, "error">
): { readonly tag: string | null; readonly message: string | null } => {
  const error = job.error as {
    tag?: unknown;
    message?: unknown;
  } | null;
  return {
    tag: typeof error?.tag === "string" ? error.tag : null,
    message: typeof error?.message === "string" ? error.message : null,
  };
};
