import { Either, Schema } from "effect";

/**
 * What travels from the Sidecar to a browser tab, through the app server's
 * `/api/jobs/events` proxy: Server-Sent Events, each a JSON `data` line.
 *
 * - `snapshot` (first, on a fresh connection): every Job not yet finished,
 *   every failed or interrupted one not dismissed, and every one that
 *   succeeded in the last 24 hours not dismissed, each with all its Job
 *   Events. Its SSE `id` is the newest event id at that moment.
 * - `job-event` (then, live): one Job Event and the Job it belongs to. Its SSE
 *   `id` is the event's, so a tab that reconnects resumes after it
 *   (`Last-Event-ID`) instead of starting over.
 * - `sidecar-unavailable` (from the proxy alone): nothing answered on the
 *   sidecar's socket. The browser reconnects on its own.
 * - `sidecar-available` (from the proxy alone, first): the sidecar answered.
 *   A reconnect after a restart replays after `Last-Event-ID` and sends no
 *   snapshot, so this is what says the sidecar is back.
 *
 * The sidecar writes these with `JSON.stringify`, so dates arrive as ISO
 * strings. Both ends import this file; the browser decodes with it.
 */

export const JOB_STREAM_EVENTS = {
  snapshot: "snapshot",
  jobEvent: "job-event",
  sidecarUnavailable: "sidecar-unavailable",
  sidecarAvailable: "sidecar-available",
} as const;

export const WireJob = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  title: Schema.String,
  attempt: Schema.Number,
  maxAttempts: Schema.Number,
  subjectType: Schema.NullOr(Schema.String),
  subjectId: Schema.NullOr(Schema.String),
  /**
   * When it was enqueued (ISO): the order the Sidecar claims a Lane's Jobs in
   * (`claimNextJob` takes the oldest `created_at` first).
   */
  createdAt: Schema.String,
});
export type WireJob = typeof WireJob.Type;

export const WireJobEvent = Schema.Struct({
  id: Schema.Number,
  jobId: Schema.String,
  type: Schema.String,
  data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  at: Schema.String,
});
export type WireJobEvent = typeof WireJobEvent.Type;

export const JobSnapshotMessage = Schema.Struct({
  cursor: Schema.Number,
  jobs: Schema.Array(
    Schema.Struct({ job: WireJob, events: Schema.Array(WireJobEvent) })
  ),
});
export type JobSnapshotMessage = typeof JobSnapshotMessage.Type;

/**
 * `GET /api/jobs/stage-history`: the newest succeeded Jobs of each kind, oldest
 * finish first, each with its Job Events minus repeated progress. The ETA's
 * stage history is folded from these (`job-stage-history.ts`).
 */
export const JobStageHistoryMessage = Schema.Struct({
  jobs: Schema.Array(
    Schema.Struct({ job: WireJob, events: Schema.Array(WireJobEvent) })
  ),
});
export type JobStageHistoryMessage = typeof JobStageHistoryMessage.Type;

export const JOBS_STAGE_HISTORY_HREF = "/api/jobs/stage-history";

export const JobEventMessage = Schema.Struct({
  job: WireJob,
  event: WireJobEvent,
});
export type JobEventMessage = typeof JobEventMessage.Type;

/** `POST /api/jobs`'s answer: the Job that does the work. */
export const EnqueueAnswer = Schema.Struct({ id: Schema.String });

export const SidecarUnavailableMessage = Schema.Struct({
  message: Schema.String,
});

/** Parse one SSE `data` line against `schema`; `undefined` if it does not fit. */
export const decodeStreamData = <A, I>(
  schema: Schema.Schema<A, I>,
  data: string
): A | undefined => {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  return Either.getOrUndefined(Schema.decodeUnknownEither(schema)(json));
};

/** Where a Job's log is read in the browser (the sidecar's `<job id>.jsonl`). */
export const jobLogHref = (jobId: string) =>
  `/api/jobs/${encodeURIComponent(jobId)}/log`;

/**
 * The Job kinds that POST to an outside service (decision 5 in
 * docs/plans/background-jobs-sidecar.md): each runs once, a cut-off run ends
 * "interrupted — check before retrying", and only the author's Retry runs it
 * again. The sidecar's registry is the authority (`definePostingJobKind`);
 * `sidecar/posting-kinds.test.ts` holds this list to it.
 */
export const POSTING_JOB_KINDS: readonly string[] = [
  "youtube",
  "youtube-shorts",
  "buffer",
  "ai-hero",
  "skills-changelog",
];

export const isPostingJobKind = (kind: string) =>
  POSTING_JOB_KINDS.includes(kind);

/** Where the author's Retry of a post is sent. */
/** The author's Cancel on a Job that can be cancelled (a Storage move). */
/**
 * The kinds whose row offers Cancel: each cleans up after itself (a Storage
 * move removes its partial copies). The server's list is
 * `CANCELLABLE_JOB_KINDS` (`sidecar/job-specs.ts`).
 */
export const CANCELLABLE_JOB_KIND_NAMES: readonly string[] = [
  "storage-move",
  "storage-delete",
];

export const isCancellableJobKind = (kind: string) =>
  CANCELLABLE_JOB_KIND_NAMES.includes(kind);

export const jobCancelHref = (jobId: string) =>
  `/api/jobs/${encodeURIComponent(jobId)}/cancel`;

export const jobRetryHref = (jobId: string) =>
  `/api/jobs/${encodeURIComponent(jobId)}/retry`;

/** Where the author's Dismiss and "Clear finished" go: `{ jobIds }`. */
export const JOBS_DISMISS_HREF = "/api/jobs/dismiss";

/**
 * What an interrupted Publish says, on its row and in its toast. A Publish is
 * never run again on its own (section 7.2 of
 * docs/plans/background-jobs-sidecar.md): cut off after Submit, it leaves a
 * Pending Version, and the publish page reads the Dropbox receipt and offers
 * Promote or Discard. Cut off before Submit, there is nothing to reconcile.
 */
export const PUBLISH_INTERRUPTED_MESSAGE =
  "Interrupted, and never re-run on its own. If it got past Submit, its Pending Version is waiting on the publish page: Promote or Discard it there, then publish again";

/**
 * The tags a Publish Job fails with when the publish kind named the failure
 * itself (`sidecar/kinds/publish.ts`): refused (`PublishRefusedError`), or a
 * Commit failure the service already Discarded (`PublishRunError`). Neither
 * leaves a Pending Version. Any other tag past Submit (Promote failing, say)
 * may.
 */
const PUBLISH_NOTHING_PENDING_TAGS: readonly string[] = [
  "PublishRefusedError",
  "PublishRunError",
];

/**
 * Whether a settled Publish Job may have left a Pending Version, for the
 * author to Promote or Discard on the publish page: cut off at any point
 * (its events may stop short of `submitted`), or failed past Submit for a
 * reason the service did not Discard itself.
 */
export const mayLeavePendingVersion = (publish: {
  readonly status: string;
  readonly submitted: boolean;
  readonly errorTag: string | null;
}): boolean =>
  publish.status === "interrupted" ||
  (publish.status === "failed" &&
    publish.submitted &&
    !PUBLISH_NOTHING_PENDING_TAGS.includes(publish.errorTag ?? ""));

/** Where an interrupted Publish is reconciled, by hand. */
export const publishPageHref = (courseId: string) =>
  `/courses/${encodeURIComponent(courseId)}/publish`;
