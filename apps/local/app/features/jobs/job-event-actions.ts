import type { JobEventMessage } from "./job-wire";
import type { jobsReducer } from "./jobs-reducer";
import { toDate } from "@/packages/clock";

/**
 * Job Events off the wire as jobs-reducer actions: the one place that reads
 * what `db-job-operations` and the handlers write into `job_event.data`.
 */

const errorMessageOf = (data: Record<string, unknown>): string => {
  const error = data.error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "The job failed";
};

const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" ? value : fallback;

const errorTagOf = (data: Record<string, unknown>): string | null => {
  const error = data.error;
  return typeof error === "object" &&
    error !== null &&
    "tag" in error &&
    typeof error.tag === "string"
    ? error.tag
    : null;
};

const POST_CHECK_VERDICTS = ["posted", "not-posted", "unknown"] as const;

const postCheckOf = (
  data: Record<string, unknown>
): jobsReducer.PostCheckView | null => {
  const verdict = POST_CHECK_VERDICTS.find((v) => v === data.verdict);
  if (!verdict) return null;
  return {
    verdict,
    detail: typeof data.detail === "string" ? data.detail : "",
    url: typeof data.url === "string" ? data.url : null,
  };
};

/**
 * One Job Event off the wire as a reducer action, or `null` for a type this
 * tab has no use for. `receivedAt` is this tab's clock when a live event
 * arrived (`null` for a snapshot's replay): with the event's own `at`, the
 * database's clock, it tells the reducer how far apart the two clocks are
 * (`clockOffsetOf`). `event.type` is what `db-job-operations` and the
 * handlers write: `queued`, `started`, `stage`, `progress`, `retrying`,
 * `requeued`, `succeeded`, `failed`, `interrupted`, `dismissed`.
 */
export const toJobsAction = (
  message: JobEventMessage,
  receivedAt: number | null = null
): jobsReducer.JobStreamAction | null => {
  const { job, event } = message;
  const base = {
    job,
    eventId: event.id,
    at: toDate(event.at).getTime(),
    receivedAt,
  };
  const data = event.data;
  switch (event.type) {
    case "queued":
      return {
        ...base,
        type: "job-queued",
        // A Retry re-queues the row as its next attempt and says which.
        attempt: typeof data.attempt === "number" ? data.attempt : null,
        dependsOn: typeof data.dependsOn === "string" ? data.dependsOn : null,
      };
    case "started":
      return {
        ...base,
        type: "job-started",
        attempt: numberOr(data.attempt, job.attempt),
      };
    case "stage":
      return typeof data.stage === "string"
        ? { ...base, type: "job-stage-entered", stage: data.stage }
        : null;
    case "progress":
      return typeof data.stage === "string" && typeof data.percent === "number"
        ? {
            ...base,
            type: "job-progressed",
            stage: data.stage,
            percent: data.percent,
          }
        : null;
    case "retrying":
      return {
        ...base,
        type: "job-retrying",
        nextAttempt: numberOr(data.nextAttempt, job.attempt),
        message: errorMessageOf(data),
      };
    case "requeued":
      return {
        ...base,
        type: "job-requeued",
        attempt: numberOr(data.attempt, job.attempt),
      };
    case "succeeded":
      return { ...base, type: "job-succeeded" };
    case "failed":
      return {
        ...base,
        type: "job-failed",
        message: errorMessageOf(data),
        tag: errorTagOf(data),
      };
    case "interrupted":
      return {
        ...base,
        type: "job-interrupted",
        message: errorMessageOf(data),
        tag: errorTagOf(data),
      };
    case "dismissed":
      return { ...base, type: "job-dismissed" };
    case "cancel-requested":
      return { ...base, type: "job-cancel-requested" };
    case "cancelled":
      return {
        ...base,
        type: "job-cancelled",
        message: typeof data.message === "string" ? data.message : null,
      };
    case "posted":
      return { ...base, type: "job-posted", result: { ...data } };
    // What a Storage move or delete did: the Storage pages draw it (#2157).
    case "storage-moved":
    case "storage-deleted":
      return { ...base, type: "job-result-reported", result: { ...data } };
    case "post-check": {
      const check = postCheckOf(data);
      return check
        ? {
            ...base,
            type: "job-post-checked",
            check,
            attempt: typeof data.attempt === "number" ? data.attempt : null,
          }
        : null;
    }
    case "videos":
      return Array.isArray(data.videos)
        ? {
            ...base,
            type: "batch-videos-announced",
            videos: data.videos.flatMap((v: unknown) =>
              typeof v === "object" &&
              v !== null &&
              "id" in v &&
              "title" in v &&
              typeof v.id === "string" &&
              typeof v.title === "string"
                ? [{ id: v.id, title: v.title }]
                : []
            ),
          }
        : null;
    case "video-stage":
      return typeof data.videoId === "string" && typeof data.stage === "string"
        ? {
            ...base,
            type: "batch-video-stage-entered",
            videoId: data.videoId,
            stage: data.stage,
          }
        : null;
    case "video-progress":
      return typeof data.videoId === "string" &&
        typeof data.stage === "string" &&
        typeof data.percent === "number"
        ? {
            ...base,
            type: "batch-video-progressed",
            videoId: data.videoId,
            stage: data.stage,
            percent: data.percent,
          }
        : null;
    case "video-succeeded":
      return typeof data.videoId === "string"
        ? {
            ...base,
            type: "batch-video-succeeded",
            videoId: data.videoId,
            kept: keptOf(data.kept),
          }
        : null;
    case "video-failed":
      return typeof data.videoId === "string"
        ? {
            ...base,
            type: "batch-video-failed",
            videoId: data.videoId,
            message:
              typeof data.message === "string"
                ? data.message
                : "The export failed",
          }
        : null;
    case "video-upload-queued":
      return typeof data.videoId === "string"
        ? {
            ...base,
            type: "batch-video-upload-queued",
            videoId: data.videoId,
          }
        : null;
    case "video-upload-progress":
      return typeof data.videoId === "string" &&
        typeof data.uploadedBytes === "number" &&
        typeof data.totalBytes === "number"
        ? {
            ...base,
            type: "batch-video-upload-progressed",
            videoId: data.videoId,
            uploadedBytes: data.uploadedBytes,
            totalBytes: data.totalBytes,
          }
        : null;
    case "submitted":
      return { ...base, type: "job-submitted" };
    case "published":
      return { ...base, type: "job-published", result: { ...data } };
    case "video-handed-off":
      return typeof data.videoId === "string"
        ? { ...base, type: "batch-video-handed-off", videoId: data.videoId }
        : null;
    default:
      return null;
  }
};

/** A Course Autofill's offered text for the fields the author kept. */
const keptOf = (value: unknown): jobsReducer.AutofillKeptView[] =>
  Array.isArray(value)
    ? value.flatMap((entry) =>
        typeof entry?.field === "string" && typeof entry?.proposal === "string"
          ? [{ field: entry.field, proposal: entry.proposal }]
          : []
      )
    : [];
