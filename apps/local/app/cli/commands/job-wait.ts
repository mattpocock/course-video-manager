import { Options } from "@effect/cli";
import { Data, Effect, Option } from "effect";
import {
  JobOperationsService,
  POSTED_EVENT,
  type Job,
} from "@cvm/core/services/db-job-operations.server";
import { notFound, parseError } from "@/cli/helpers";
import { CliOutput } from "@/cli/output";
import { followJob, jobFailureOf, type SettledJob } from "./job-follow";

/**
 * `cvm job get|list|wait` and `cvm video post-youtube --wait`: a Sidecar Job
 * as an agent reads it, and the wait on several at once.
 */

/** Where the Sidecar keeps every line a Job logged (the repo's CLAUDE.md). */
export const jobLogPath = (jobId: string) => `.data/logs/jobs/${jobId}.jsonl`;

/** One Job, as `cvm job list` prints it: never its params. */
export const jobRow = (job: Job) => {
  const failure = jobFailureOf(job);
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    subject:
      job.subjectType && job.subjectId
        ? { type: job.subjectType, id: job.subjectId }
        : null,
    dependsOn: job.dependsOn,
    error: job.error ? failure : null,
    // ISO strings: the emit helpers walk objects, so a Date would print {}.
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    log: jobLogPath(job.id),
  };
};

/**
 * One Job, as `cvm job get` and `cvm job wait` print it: its params, its
 * progress, and — for a posting Job — what it posted (a YouTube id and the
 * Studio link), from its `posted` Job Event.
 */
export const jobDetail = Effect.fn("jobDetail")(function* (job: Job) {
  const ops = yield* JobOperationsService;
  const events = yield* ops.listJobEvents(job.id);
  const posted = events.findLast((e) => e.type === POSTED_EVENT)?.data ?? null;
  return {
    ...jobRow(job),
    params: job.params,
    progress: job.progress,
    posted,
  };
});

/** A Job the caller waited on ended any way but `succeeded`. */
export class JobFailedError extends Data.TaggedError("JobFailedError")<{
  /** Every Job waited on that did not succeed, with why. */
  readonly failed: ReadonlyArray<{
    readonly jobId: string;
    readonly kind: string;
    readonly status: SettledJob["status"];
    /** The failure's own tag, as the Job recorded it. */
    readonly cause: string | null;
    readonly message: string | null;
  }>;
  readonly message: string;
}> {}

/** `--timeout` ran out with Jobs still queued or running. */
export class JobWaitTimeoutError extends Data.TaggedError(
  "JobWaitTimeoutError"
)<{
  readonly pending: ReadonlyArray<{
    readonly jobId: string;
    readonly status: string;
  }>;
  readonly message: string;
}> {}

const failureLine = (job: SettledJob) => {
  const { tag, message } = jobFailureOf(job);
  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    cause: tag,
    message,
  };
};

/**
 * Wait on every Job in `jobIds` until each settles, and return them in the
 * order given. Every id is checked first (an unknown one is exit 2, before
 * any waiting); any Job that does not succeed ends `JobFailedError`, naming
 * each that did not; `timeoutMs` running out ends `JobWaitTimeoutError`.
 */
export const waitForJobs = Effect.fn("waitForJobs")(function* (input: {
  readonly jobIds: ReadonlyArray<string>;
  readonly pollMs: number;
  /** `null`: wait for as long as it takes. */
  readonly timeoutMs: number | null;
  readonly onWaiting: (line: Record<string, unknown>) => Effect.Effect<void>;
}) {
  const ops = yield* JobOperationsService;
  for (const jobId of input.jobIds) {
    if (!(yield* ops.getJob(jobId))) return yield* notFound("job", jobId);
  }

  const follow = Effect.forEach(
    input.jobIds,
    (jobId) =>
      followJob({
        jobId,
        pollMs: input.pollMs,
        what: `Job ${jobId}`,
        onWaiting: input.onWaiting,
      }).pipe(
        Effect.flatMap((job) =>
          job ? Effect.succeed(job) : notFound("job", jobId)
        )
      ),
    { concurrency: "unbounded" }
  );

  const settled =
    input.timeoutMs === null
      ? yield* follow
      : yield* follow.pipe(
          Effect.timeoutFail({
            duration: input.timeoutMs,
            onTimeout: () => "timeout" as const,
          }),
          Effect.catchIf(
            (e) => e === "timeout",
            () =>
              Effect.gen(function* () {
                const pending: { jobId: string; status: string }[] = [];
                for (const jobId of input.jobIds) {
                  const job = yield* ops.getJob(jobId);
                  if (job?.status === "queued" || job?.status === "running") {
                    pending.push({ jobId, status: job.status });
                  }
                }
                return yield* new JobWaitTimeoutError({
                  pending,
                  message: `--timeout ran out with ${pending.length} of ${input.jobIds.length} Jobs still queued or running: ${pending.map((p) => `${p.jobId} (${p.status})`).join(", ")}. Nothing was stopped; run 'cvm job wait' again to keep waiting.`,
                });
              })
          )
        );

  const failed = settled.filter((job) => job.status !== "succeeded");
  if (failed.length > 0) {
    const lines = failed.map(failureLine);
    return yield* new JobFailedError({
      failed: lines,
      message: lines
        .map(
          (l) =>
            `Job ${l.jobId} (${l.kind}) ended ${l.status}${l.message ? `: ${l.message}` : ""}`
        )
        .join("; "),
    });
  }
  return settled;
});

/** How often a waiting verb reads its Jobs. */
export const JOB_POLL_MS = 1_000;

/** `--timeout` in minutes as milliseconds, or invalid input (exit 3). */
export const timeoutMsOf = (minutes: Option.Option<number>) =>
  Option.match(minutes, {
    onNone: () => Effect.succeed(null),
    onSome: (m) =>
      m > 0
        ? Effect.succeed(Math.round(m * 60_000))
        : parseError("--timeout must be a positive number of minutes", "job"),
  });

export const timeoutOption = Options.float("timeout").pipe(
  Options.withDescription(
    "give up after this many minutes (default: wait as long as it takes)"
  ),
  Options.optional
);

/** Wait on `jobIds` and print each settled Job: what `--wait` verbs share. */
export const waitAndEmit = (input: {
  readonly jobIds: ReadonlyArray<string>;
  readonly timeoutMs: number | null;
}) =>
  Effect.gen(function* () {
    const out = yield* CliOutput;
    const jobs = yield* waitForJobs({
      jobIds: input.jobIds,
      pollMs: JOB_POLL_MS,
      timeoutMs: input.timeoutMs,
      onWaiting: (line) => out.stderr(JSON.stringify(line) + "\n"),
    });
    return yield* Effect.forEach(jobs, (job) => jobDetail(job));
  });
