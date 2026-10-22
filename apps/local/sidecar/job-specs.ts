import { Data, Effect, Schema, type ParseResult } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { LiveJob } from "@cvm/core/services/db-job-enqueue.server";
import { liveJobCoversClips } from "@/features/video-editor/transcribe-clips-response";
import {
  liveVoiceJobCovers,
  type ClipMockupVoiceRequest,
} from "@cvm/core/features/clip-mockups/voice-job-cover";
import { isPostingKind } from "./job-kind";
import { JOB_PARAMS } from "./job-params";
import type { LaneName } from "./lanes";
import {
  CLIP_MOCKUP_VOICE_POLICY,
  CLIP_TRANSCRIPTION_POLICY,
  COURSE_DUPLICATE_POLICY,
  FOOTAGE_TRANSCRIPTION_POLICY,
  IMAGE_UPLOAD_POLICY,
  POSTING_JOB_POLICY,
  RETRYING_JOB_POLICY,
  STORAGE_DELETE_POLICY,
  STORAGE_MOVE_POLICY,
  UPLOAD_MANAGER_POLICIES,
  type JobPolicy,
} from "./retry-policy";

/**
 * What the app server knows of a kind of Job: where it runs, how often, and
 * what params it takes — never its handler. A route enqueues and retries
 * against these, so no route reaches ffmpeg, Remotion or a posting service
 * (the spawn guard, `.dependency-cruiser.cjs`). Every kind in `JOB_KINDS`
 * (`job-kinds.ts`, the Sidecar's registry) has one here, with the same
 * policy: `job-specs.test.ts`.
 */
export interface JobKindSpec {
  readonly lane: LaneName;
  readonly maxAttempts: number;
  readonly posting?: boolean;
  readonly neverRequeued?: boolean;
  readonly decodeParams: (
    raw: unknown
  ) => Effect.Effect<unknown, ParseResult.ParseError>;
  /**
   * Whether a live Job of this kind, for the same subject, already does the
   * work `params` asks for: then an enqueue answers with it and adds none.
   * Absent for a kind where two of the same Job are fine.
   */
  readonly coveredBy?: (params: unknown, live: LiveJob) => boolean;
  /**
   * Whether a request for `params` must wait for a live Job of this kind,
   * for the same subject: then it is added depending on that Job, so the
   * two never run side by side.
   */
  readonly queuesBehind?: (params: unknown, live: LiveJob) => boolean;
}

export type JobKindSpecs = Readonly<Record<string, JobKindSpec>>;

const spec = <A, I>(
  policy: JobPolicy,
  params: Schema.Schema<A, I>
): JobKindSpec => ({ ...policy, decodeParams: Schema.decodeUnknown(params) });

export const JOB_KIND_SPECS = {
  noop: spec(RETRYING_JOB_POLICY, JOB_PARAMS.noop),
  export: spec(UPLOAD_MANAGER_POLICIES.export, JOB_PARAMS.export),
  // A second press while one is queued or running joins it: both would
  // render the same file to the same address.
  "export-animatic": {
    ...spec(
      UPLOAD_MANAGER_POLICIES["export-animatic"],
      JOB_PARAMS["export-animatic"]
    ),
    coveredBy: () => true,
  },
  "render-vertical": spec(
    UPLOAD_MANAGER_POLICIES["render-vertical"],
    JOB_PARAMS["render-vertical"]
  ),
  "batch-export": spec(
    UPLOAD_MANAGER_POLICIES["batch-export"],
    JOB_PARAMS["batch-export"]
  ),
  autofill: spec(UPLOAD_MANAGER_POLICIES.autofill, JOB_PARAMS.autofill),
  // Two live Jobs for the same Clips would pay Whisper twice and race for
  // the Clips' rows: a second tab's or a double click's request joins the
  // first while it still holds every one of them.
  "transcribe-clips": {
    ...spec(CLIP_TRANSCRIPTION_POLICY, JOB_PARAMS["transcribe-clips"]),
    coveredBy: (params, live) =>
      liveJobCoversClips(
        (params as { clipIds: ReadonlyArray<string> }).clipIds,
        live
      ),
  },
  // A second `cvm footage transcribe` of a file already being transcribed
  // follows the first Job rather than paying Whisper for it twice.
  "transcribe-footage": {
    ...spec(FOOTAGE_TRANSCRIPTION_POLICY, JOB_PARAMS["transcribe-footage"]),
    coveredBy: (params, live) =>
      (live.params as { path?: unknown } | null)?.path ===
      (params as { path: string }).path,
  },
  // Upload pressed again (the tab closed before the first Job settled) waits
  // for the live Job for the same body, then reuses every URL it recorded
  // rather than uploading each image a second time.
  "upload-images": {
    ...spec(IMAGE_UPLOAD_POLICY, JOB_PARAMS["upload-images"]),
    queuesBehind: (params, live) =>
      (live.params as { body?: unknown } | null)?.body ===
      (params as { body: string }).body,
  },
  "remove-local-images": spec(
    IMAGE_UPLOAD_POLICY,
    JOB_PARAMS["remove-local-images"]
  ),
  "duplicate-course": spec(
    COURSE_DUPLICATE_POLICY,
    JOB_PARAMS["duplicate-course"]
  ),
  "storage-move": spec(STORAGE_MOVE_POLICY, JOB_PARAMS["storage-move"]),
  "storage-delete": spec(STORAGE_DELETE_POLICY, JOB_PARAMS["storage-delete"]),
  // One live Job per Clip Mockup and line: a request whose lines a live Job
  // will voice (it has not read its rows yet, or is voicing those very
  // words) adds none. New words always get a Job of their own.
  "clip-mockup-voice": {
    ...spec(CLIP_MOCKUP_VOICE_POLICY, JOB_PARAMS["clip-mockup-voice"]),
    coveredBy: (params, live) =>
      liveVoiceJobCovers(params as ClipMockupVoiceRequest, live),
  },
  publish: spec(UPLOAD_MANAGER_POLICIES.publish, JOB_PARAMS.publish),
  youtube: spec(POSTING_JOB_POLICY, JOB_PARAMS.youtube),
  "youtube-shorts": spec(POSTING_JOB_POLICY, JOB_PARAMS["youtube-shorts"]),
  buffer: spec(POSTING_JOB_POLICY, JOB_PARAMS.buffer),
  "ai-hero": spec(POSTING_JOB_POLICY, JOB_PARAMS["ai-hero"]),
  "skills-changelog": spec(POSTING_JOB_POLICY, JOB_PARAMS["skills-changelog"]),
} as const satisfies Record<keyof typeof JOB_PARAMS, JobKindSpec>;

/**
 * The kinds the author can Cancel (`requestJobCancel`): each cleans up after
 * itself when asked. A Storage move removes its partial copies; a Storage
 * delete stops before its next file.
 */
export const CANCELLABLE_JOB_KINDS: readonly string[] = [
  "storage-move",
  "storage-delete",
];

export class UnknownJobKindError extends Data.TaggedError(
  "UnknownJobKindError"
)<{ readonly kind: string; readonly message: string }> {}

export class NoAttemptsLeftError extends Data.TaggedError(
  "NoAttemptsLeftError"
)<{ readonly kind: string; readonly message: string }> {}

/**
 * The one way to start background work: a row in the job table, with the
 * kind's own lane and attempt count. The params are checked against the
 * kind's schema here, so a bad request fails at the caller, not in the
 * sidecar later.
 */
export const enqueueJob = Effect.fn("enqueueJob")(function* (input: {
  /** The id the caller chose for it (the browser does), or `null` for a fresh one. */
  id: string | null;
  kind: string;
  title: string;
  params: unknown;
  dependsOn: string | null;
  subject: { type: string; id: string } | null;
  /**
   * Attempts this work already spent before it became a Job: a Batch export
   * child the browser retries hands its export to the sidecar with the
   * attempts it had left, so it runs as many times in all as it did when the
   * browser retried it (docs/plans/background-jobs-sidecar.md, section 7.1).
   * 0 for new work.
   */
  attemptsSpent: number;
  /**
   * `JOB_KIND_SPECS` (or, in the sidecar and in tests, its kinds: a kind is
   * a spec with a handler). Enqueueing never runs a kind.
   */
  registry: JobKindSpecs;
}) {
  const registry = input.registry;
  const kind = Object.hasOwn(registry, input.kind)
    ? registry[input.kind]
    : undefined;
  if (!kind) {
    return yield* new UnknownJobKindError({
      kind: input.kind,
      message: `no such job kind: ${input.kind}`,
    });
  }
  const params = yield* kind.decodeParams(input.params);
  const maxAttempts = kind.maxAttempts - input.attemptsSpent;
  if (input.attemptsSpent < 0 || maxAttempts < 1) {
    return yield* new NoAttemptsLeftError({
      kind: input.kind,
      message: `a ${input.kind} Job runs at most ${kind.maxAttempts} times; ${input.attemptsSpent} were already spent`,
    });
  }
  const ops = yield* JobOperationsService;
  return yield* ops.enqueueJob({
    id: input.id,
    kind: input.kind,
    title: input.title,
    lane: kind.lane,
    params: input.params ?? {},
    maxAttempts,
    dependsOn: input.dependsOn,
    subject: input.subject,
    ...(kind.coveredBy
      ? { coveredBy: (live: LiveJob) => kind.coveredBy!(params, live) }
      : {}),
    ...(kind.queuesBehind
      ? { queuesBehind: (live: LiveJob) => kind.queuesBehind!(params, live) }
      : {}),
  });
});

export class JobNotFoundError extends Data.TaggedError("JobNotFoundError")<{
  readonly jobId: string;
  readonly message: string;
}> {}

export class JobNotRetryableError extends Data.TaggedError(
  "JobNotRetryableError"
)<{ readonly jobId: string; readonly message: string }> {}

/**
 * The author's Retry. Only a POST waits for one (decision 5): every other
 * kind retries on its own while it has attempts, and is not run again by
 * hand. Runs the post once more — the same row, `attempt + 1` — and only if
 * the run the author saw (`attempt`) failed or was interrupted without
 * going out.
 */
export const retryJob = Effect.fn("retryJob")(function* (input: {
  jobId: string;
  /** The run the author retried: a Retry of any other run is refused. */
  attempt: number;
  registry: JobKindSpecs;
}) {
  const ops = yield* JobOperationsService;
  const job = yield* ops.getJob(input.jobId);
  if (!job) {
    return yield* new JobNotFoundError({
      jobId: input.jobId,
      message: `no job ${input.jobId}`,
    });
  }
  const kind = Object.hasOwn(input.registry, job.kind)
    ? input.registry[job.kind]
    : undefined;
  if (!isPostingKind(kind)) {
    return yield* new JobNotRetryableError({
      jobId: job.id,
      message: `a ${job.kind} Job retries on its own; only a post waits for the author's Retry`,
    });
  }
  const retried = yield* ops.retryJob({
    jobId: job.id,
    attempt: input.attempt,
  });
  switch (retried.outcome) {
    case "queued":
      return retried.job;
    case "not-found":
      return yield* new JobNotFoundError({
        jobId: job.id,
        message: `no job ${job.id}`,
      });
    case "not-retryable":
      return yield* new JobNotRetryableError({
        jobId: job.id,
        message: `"${job.title}" is ${retried.job.status}: only a failed or interrupted post can be retried`,
      });
    case "stale":
      return yield* new JobNotRetryableError({
        jobId: job.id,
        message: `"${job.title}" has run again since (run ${retried.job.attempt}); look at that run before retrying`,
      });
    case "went-out":
      return yield* new JobNotRetryableError({
        jobId: job.id,
        message: `"${job.title}" went out: retrying would post it twice`,
      });
    case "dependency-not-succeeded":
      return yield* new JobNotRetryableError({
        jobId: job.id,
        message: `"${job.title}" waits on "${retried.dependency}", which did not succeed: start it again from its page`,
      });
  }
});
