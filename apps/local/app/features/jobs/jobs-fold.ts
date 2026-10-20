import { PUBLISH_INTERRUPTED_MESSAGE, type WireJob } from "./job-wire";
import type { jobsReducer } from "./jobs-reducer";

/**
 * How one Job Event changes what a tab knows of its Job: the state machine
 * the jobs reducer applies to the live stream and to a snapshot's replay
 * alike (`jobs-reducer.ts`).
 */

/** A wire Job's enqueue time, in epoch ms; `null` if it does not parse. */
const createdAtOf = (job: WireJob): number | null => {
  const at = Date.parse(job.createdAt);
  return Number.isFinite(at) ? at : null;
};

export const viewOf = (
  job: WireJob,
  status: jobsReducer.JobStatus
): jobsReducer.JobView => ({
  id: job.id,
  kind: job.kind,
  title: job.title,
  subjectType: job.subjectType,
  subjectId: job.subjectId,
  status,
  attempt: job.attempt,
  stage: null,
  percent: null,
  errorMessage: null,
  errorTag: null,
  dependsOn: null,
  createdAt: createdAtOf(job),
  enqueued: true,
  result: null,
  postCheck: null,
  submitted: false,
  cancelRequested: false,
  lastEventId: 0,
  videos: null,
});

/** Apply `change` to one of a batch's Videos; unknown Videos are ignored. */
const updateVideo = (
  job: jobsReducer.JobView,
  videoId: string,
  change: Partial<jobsReducer.BatchVideoView>
): jobsReducer.JobView => ({
  ...job,
  videos:
    job.videos?.map((video) =>
      video.id === videoId ? { ...video, ...change } : video
    ) ?? null,
});

/**
 * Apply `change` to one of a Job's Videos that has not settled yet. A settled
 * Video stays settled: a Publish's Dropbox commit is retried once inside the
 * service, which replays the upload events of Videos that already landed, and
 * the browser's row ignored them (`isSettled` in the Upload Manager). A
 * re-announcement (a run after a stop) is what reopens a Video.
 */
const updateLiveVideo = (
  job: jobsReducer.JobView,
  videoId: string,
  change: Partial<jobsReducer.BatchVideoView>
): jobsReducer.JobView => {
  const video = job.videos?.find((v) => v.id === videoId);
  if (video?.status === "succeeded" || video?.status === "failed") return job;
  return updateVideo(job, videoId, change);
};

/**
 * A batch announces the Videos it will export. A batch put back by a
 * stopping sidecar announces again, without the ones it already finished:
 * those keep their rows.
 */
const announceVideos = (
  job: jobsReducer.JobView,
  announced: readonly { id: string; title: string }[]
): jobsReducer.JobView => {
  const known = new Map((job.videos ?? []).map((v) => [v.id, v]));
  for (const { id, title } of announced) {
    const before = known.get(id);
    if (before?.status === "succeeded" || before?.status === "handed-off") {
      continue;
    }
    known.set(id, {
      id,
      title,
      status: "queued",
      stage: null,
      percent: null,
      errorMessage: null,
      uploadStage: null,
      uploadedBytes: 0,
      totalBytes: null,
      kept: [],
    });
  }
  return { ...job, videos: [...known.values()] };
};

/**
 * Apply one Job Event to what is known of its Job: the whole state machine,
 * shared by the live stream and the snapshot's replay. `undefined` when the
 * event was already applied.
 */
export const applyStreamAction = (
  known: jobsReducer.JobView | undefined,
  action: jobsReducer.JobStreamAction
): jobsReducer.JobView | undefined => {
  if (known && action.eventId <= known.lastEventId) return undefined;
  const job: jobsReducer.JobView = {
    ...(known ?? viewOf(action.job, "queued")),
    // The sidecar's word on the title wins over what this tab asked for.
    title: action.job.title,
    // A Job this tab asked for learns when it was enqueued from its events.
    createdAt: createdAtOf(action.job),
    lastEventId: action.eventId,
  };
  switch (action.type) {
    case "job-queued":
      if (action.attempt === null) {
        return {
          ...job,
          status: "queued",
          dependsOn: action.dependsOn,
          // An enqueue that went unanswered is answered now.
          errorMessage: known?.status === "requested" ? null : job.errorMessage,
        };
      }
      // The author's Retry: a fresh run of a finished Job.
      return {
        ...job,
        status: "queued",
        attempt: action.attempt,
        dependsOn: action.dependsOn,
        stage: null,
        percent: null,
        errorMessage: null,
        errorTag: null,
        result: null,
        postCheck: null,
        submitted: false,
      };
    case "job-started":
      return {
        ...job,
        status: "running",
        attempt: action.attempt,
        stage: null,
        percent: null,
        submitted: false,
      };
    case "job-stage-entered":
      return { ...job, stage: action.stage, percent: 0 };
    case "job-progressed":
      return { ...job, stage: action.stage, percent: action.percent };
    case "job-retrying":
      return {
        ...job,
        status: "retrying",
        attempt: action.nextAttempt,
        errorMessage: action.message,
        stage: null,
        percent: null,
      };
    case "job-requeued":
      return {
        ...job,
        status: "queued",
        attempt: action.attempt,
        stage: null,
        percent: null,
      };
    case "job-succeeded":
      return {
        ...job,
        status: "succeeded",
        errorMessage: null,
        errorTag: null,
      };
    case "job-failed":
      return {
        ...job,
        status: "failed",
        errorMessage: action.message,
        errorTag: action.tag,
      };
    case "job-interrupted":
      return {
        ...job,
        status: "interrupted",
        // A Publish's own words: the Promote/Discard it waits for (§7.2).
        errorMessage:
          job.kind === "publish" ? PUBLISH_INTERRUPTED_MESSAGE : action.message,
        errorTag: action.tag,
      };
    case "job-cancel-requested":
      return { ...job, cancelRequested: true };
    case "job-cancelled":
      return {
        ...job,
        status: "cancelled",
        cancelRequested: true,
        errorMessage: action.message ?? "Cancelled before it started",
        errorTag: "JobCancelledError",
      };
    case "job-submitted":
      return { ...job, submitted: true };
    case "job-posted":
    case "job-result-reported":
    case "job-published":
      return { ...job, result: action.result };
    case "job-post-checked":
      // A check of the run before a Retry says nothing about this one.
      if (action.attempt !== null && action.attempt !== job.attempt) {
        return job;
      }
      return { ...job, postCheck: action.check };
    case "job-dismissed":
      return job;
    case "batch-videos-announced":
      return announceVideos(job, action.videos);
    case "batch-video-stage-entered":
      return updateLiveVideo(job, action.videoId, {
        status: "running",
        stage: action.stage,
        percent: 0,
      });
    case "batch-video-progressed":
      return updateLiveVideo(job, action.videoId, {
        status: "running",
        stage: action.stage,
        percent: action.percent,
      });
    case "batch-video-succeeded":
      return updateLiveVideo(job, action.videoId, {
        status: "succeeded",
        stage: null,
        percent: null,
        errorMessage: null,
        kept: action.kept,
      });
    case "batch-video-failed":
      return updateLiveVideo(job, action.videoId, {
        status: "failed",
        errorMessage: action.message,
      });
    case "batch-video-handed-off":
      return updateVideo(job, action.videoId, { status: "handed-off" });
    case "batch-video-upload-queued":
      return updateLiveVideo(job, action.videoId, {
        status: "running",
        // The encode is over: its stage no longer describes this Video.
        stage: null,
        percent: null,
        uploadStage: "queued-for-upload",
      });
    case "batch-video-upload-progressed":
      return updateLiveVideo(job, action.videoId, {
        status: "running",
        stage: null,
        percent: null,
        uploadStage: "uploading",
        uploadedBytes: action.uploadedBytes,
        totalBytes: action.totalBytes,
      });
  }
};
