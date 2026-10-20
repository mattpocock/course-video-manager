import type { EffectReducer } from "use-effect-reducer";
import {
  isPostingJobKind,
  type JobSnapshotMessage,
  type JobStageHistoryMessage,
  type WireJob,
} from "./job-wire";
import { toJobsAction } from "./job-event-actions";
import { applyStreamAction } from "./jobs-fold";
import { announceVideoSettled } from "./job-video-toasts";
import type { SucceededToast } from "./job-succeeded-toast";
import { announceSettled, loadStageHistory } from "./jobs-settled";
import { isFinishedJob, jobIdOfRow, reduceDismissal } from "./jobs-dismissal";
import { reduceEnqueueOutcome, requestedJobView } from "./jobs-enqueue";
import { reduceCancel } from "./jobs-cancel";
import { foldJobEvents, recordClockSkew, timeJobEvent } from "./jobs-timing";
import { stageHistoryFrom, type HistoryData } from "./job-stage-history";
import type { UploadTiming } from "@/features/upload-manager/upload-timing";
export { ENQUEUE_UNCONFIRMED_MESSAGE } from "./jobs-enqueue";

export { toJobsAction, isFinishedJob, jobIdOfRow };

/**
 * Background **Jobs** as this tab sees them: built only from the **Job
 * Events** the Sidecar streams (`job-wire.ts`), plus the requests this tab
 * made. The tab runs nothing, retries nothing and cancels nothing — the
 * sidecar decides all of that — so closing it loses nothing either.
 *
 * Toasts are decisions here, on a Job settling, rather than a diff of two
 * snapshots.
 */
export namespace jobsReducer {
  /**
   * - `requested`: this tab asked for it; the sidecar has not reported it yet.
   * - `queued`: waiting for the sidecar (a Job put back by a stopping
   *   sidecar is `queued` again, at the same attempt).
   * - `retrying`: an attempt failed and the next one waits in the queue.
   */
  export type JobStatus =
    | "requested"
    | "queued"
    | "running"
    | "retrying"
    | "succeeded"
    | "failed"
    | "interrupted"
    /** Stopped on the author's Cancel (a Storage move), its partials removed. */
    | "cancelled";

  export interface JobView {
    id: string;
    kind: string;
    title: string;
    subjectType: string | null;
    subjectId: string | null;
    status: JobStatus;
    attempt: number;
    /** The stage the work last reported, and how far into it (0–100). */
    stage: string | null;
    percent: number | null;
    /** The last failed attempt's message, kept while it retries. */
    errorMessage: string | null;
    /** The last failure's `_tag` (`BufferAuthError`, `JobInterrupted`, …). */
    errorTag: string | null;
    /** The Job this one waits for (a post waits for its export), if any. */
    dependsOn: string | null;
    /** Enqueued at (ms), the claim order; `null` until the enqueue lands. */
    createdAt: number | null;
    /** `false` until this tab's enqueue lands: what waits on it is held. */
    enqueued: boolean;
    /** What a post reported once it went out (`posted`): an id, a slug. */
    result: Record<string, unknown> | null;
    /** What the sidecar found when it looked for a cut-off post. */
    postCheck: PostCheckView | null;
    /**
     * A Publish got past Submit this attempt (`submitted`): a failure from
     * here may leave a Pending Version (`mayLeavePendingVersion`).
     */
    submitted: boolean;
    /** The author asked it to stop; it ends `cancelled` once it has cleaned up. */
    cancelRequested: boolean;
    /** The newest Job Event applied: an older or repeated one is ignored. */
    lastEventId: number;
    /**
     * A Batch export's Videos, in the order it announced them; `null` for
     * every other kind, and for a batch that has not announced them yet.
     */
    videos: BatchVideoView[] | null;
  }

  /**
   * One Video of a Batch export. `handed-off`: it failed its tries in the
   * batch and runs on as its own export Job, whose row replaces this one.
   */
  export interface BatchVideoView {
    id: string;
    title: string;
    status: "queued" | "running" | "succeeded" | "failed" | "handed-off";
    stage: string | null;
    percent: number | null;
    errorMessage: string | null;
    /**
     * A Publish's Video carries on into Dropbox once its bytes exist: waiting
     * for a slot in the upload pool, then moving bytes. `null` until then,
     * and always for a Batch export or an Autofill.
     */
    uploadStage: "queued-for-upload" | "uploading" | null;
    uploadedBytes: number;
    /** Its size on disk, once the upload pool picks it up. */
    totalBytes: number | null;
    /**
     * An Autofill's Video: the fields the author changed while it ran, which
     * kept their text, and what the Autofill offers instead. Empty otherwise.
     */
    kept: AutofillKeptView[];
  }

  export interface AutofillKeptView {
    field: string;
    proposal: string;
  }

  /** A `post-check` Job Event: did the interrupted post go out? */
  export interface PostCheckView {
    verdict: "posted" | "not-posted" | "unknown";
    detail: string;
    url: string | null;
  }

  /** What this tab knows of the sidecar, from the stream. */
  export type SidecarStatus = "unknown" | "running" | "not-running";

  export interface State {
    jobs: Record<string, JobView>;
    /** Enqueues held, by the id of the Job they wait on, until it lands. */
    held: Record<string, EnqueueJobEffect[]>;
    /**
     * Hidden by the author (or the idle timer); events still update nothing
     * visible. A settled Job's dismissal is also recorded on the server
     * (`dismiss-jobs`), which keeps it out of every later snapshot.
     */
    dismissed: Record<string, true>;
    sidecar: SidecarStatus;
    /** Why the sidecar is `not-running`, as the proxy put it. */
    sidecarMessage: string | null;
    /**
     * When things happened to each Job's rows, by row id: what the ETA works
     * from (`jobs-timing.ts`). Stamped with each Job Event's `at`, so a
     * snapshot's replay gives a reopened tab the same timings.
     */
    timings: Record<string, UploadTiming>;
    /**
     * This tab's clock minus the database's, for the newest live Job Events
     * (`clockOffsetOf`).
     */
    clockSkews: readonly number[];
    /**
     * The newest Job Event the last snapshot covered. The live stream starts
     * with a catch-up that re-sends the last minute of events, ones older
     * than this included: a Job the snapshot left out on purpose (dismissed)
     * comes back that way.
     */
    snapshotCursor: number;
    /**
     * Jobs this tab first heard of from the catch-up, or part-way through:
     * not in the snapshot, and not from a `queued` event newer than it. Their
     * events arrive late, so they do not move the clock offset.
     */
    joinedLate: Record<string, true>;
    /** Jobs not in the snapshot, first heard of at or below its cursor. */
    fromCatchUp: Record<string, true>;
    /**
     * How long each stage has taken in the newest succeeded Jobs, read from
     * `job_event` (`job-stage-history.ts`): the ETA's prior.
     */
    stageHistory: HistoryData;
    /** The newest `load-stage-history` asked for: an older answer is stale. */
    stageHistoryRequest: number;
  }

  /** A Job Event from the stream, as a fact about one Job. */
  type StreamFact<T extends string, D = object> = {
    type: T;
    job: WireJob;
    eventId: number;
    /** The event's `at`, by the database's clock (ms since the epoch). */
    at: number;
    /** This tab's clock when a live event arrived; `null` in a replay. */
    receivedAt: number | null;
  } & D;

  /** A Job Event this reducer understands (see `toJobsAction`). */
  export type JobStreamAction =
    | StreamFact<
        "job-queued",
        { attempt: number | null; dependsOn: string | null }
      >
    | StreamFact<"job-started", { attempt: number }>
    | StreamFact<"job-stage-entered", { stage: string }>
    | StreamFact<"job-progressed", { stage: string; percent: number }>
    | StreamFact<"job-retrying", { nextAttempt: number; message: string }>
    | StreamFact<"job-requeued", { attempt: number }>
    | StreamFact<"job-succeeded">
    | StreamFact<"job-failed", { message: string; tag: string | null }>
    | StreamFact<"job-interrupted", { message: string; tag: string | null }>
    /** The author's Cancel reached the Job: it is cleaning up. */
    | StreamFact<"job-cancel-requested">
    | StreamFact<"job-cancelled", { message: string | null }>
    | StreamFact<"job-posted", { result: Record<string, unknown> }>
    | StreamFact<"job-result-reported", { result: Record<string, unknown> }>
    /** A Publish's Submit landed: a Pending Version exists until Promote. */
    | StreamFact<"job-submitted">
    /** A Publish's Promote landed: the Versions it made, and its Lesson counts. */
    | StreamFact<"job-published", { result: Record<string, unknown> }>
    | StreamFact<
        "job-post-checked",
        { check: PostCheckView; attempt: number | null }
      >
    /** The author dismissed it, in this tab or another: it stays hidden. */
    | StreamFact<"job-dismissed">
    // A Batch export's Videos
    | StreamFact<
        "batch-videos-announced",
        { videos: { id: string; title: string }[] }
      >
    | StreamFact<
        "batch-video-stage-entered",
        { videoId: string; stage: string }
      >
    | StreamFact<
        "batch-video-progressed",
        { videoId: string; stage: string; percent: number }
      >
    | StreamFact<
        "batch-video-succeeded",
        { videoId: string; kept: AutofillKeptView[] }
      >
    | StreamFact<"batch-video-failed", { videoId: string; message: string }>
    | StreamFact<"batch-video-handed-off", { videoId: string }>
    // A Publish's Videos, on into Dropbox
    | StreamFact<"batch-video-upload-queued", { videoId: string }>
    | StreamFact<
        "batch-video-upload-progressed",
        { videoId: string; uploadedBytes: number; totalBytes: number }
      >;

  export type Action =
    // Gestures and requests from this tab
    | {
        type: "job-requested";
        /** Chosen by the provider (`crypto.randomUUID()`), never here. */
        id: string;
        kind: string;
        title: string;
        params: Record<string, unknown>;
        subject: { type: string; id: string } | null;
        attemptsSpent: number;
        /** A Job this one waits for: it runs only once that one succeeds. */
        dependsOn: string | null;
      }
    | { type: "press-dismiss"; id: string }
    /** "Clear finished": dismiss every settled Job at once. */
    | { type: "press-clear-finished" }
    | { type: "dismiss-failed"; ids: string[]; message: string }
    /** The author's Retry on a failed or interrupted post. */
    | { type: "press-retry"; id: string }
    | { type: "retry-failed"; id: string; message: string }
    /** The author's Cancel on a Job that can be cancelled (a Storage move). */
    | { type: "press-cancel"; id: string }
    | { type: "cancel-failed"; id: string; message: string }
    /** Nothing has run for a while: the succeeded rows have been seen. */
    | { type: "idle-timeout-elapsed" }
    // The enqueue request's outcome
    | {
        type: "enqueue-succeeded";
        id: string;
        /**
         * The Job the server answered with: `id`, or a live Job that already
         * does this work (a kind with one live Job per piece of work).
         */
        answeredBy: string;
      }
    /** The server answered, and refused it. */
    | { type: "enqueue-failed"; id: string; message: string }
    /**
     * No answer came (the network failed, or the server broke before it could
     * say): the Job may or may not exist. `enqueue` is the request as sent.
     */
    | { type: "enqueue-unanswered"; enqueue: EnqueueJobEffect; message: string }
    // The stream
    | { type: "job-snapshot-received"; snapshot: JobSnapshotMessage }
    | { type: "sidecar-unavailable"; message: string }
    /** The proxy reached the sidecar: it runs, whatever the stream sends next. */
    | { type: "sidecar-available" }
    // The stage history's load
    | {
        type: "stage-history-loaded";
        requestId: number;
        history: JobStageHistoryMessage;
      }
    | { type: "stage-history-load-failed"; requestId: number }
    | JobStreamAction;

  export interface EnqueueJobEffect {
    type: "enqueue-job";
    id: string;
    kind: string;
    title: string;
    params: Record<string, unknown>;
    subject: { type: string; id: string } | null;
    attemptsSpent: number;
    dependsOn: string | null;
    /** How many times this request went unanswered before: 0 the first time. */
    checks: number;
    /** Wait this long before sending it. */
    afterMs: number;
  }

  export type Effect =
    | EnqueueJobEffect
    /** Read the stage history (`GET /api/jobs/stage-history`). */
    | { type: "load-stage-history"; requestId: number }
    /** The server refuses a Retry of any run but `attempt`. */
    | { type: "retry-job"; id: string; attempt: number }
    | { type: "cancel-job"; id: string }
    | { type: "show-cancel-failed-toast"; title: string; message: string }
    /** Record the author's Dismiss on the server, so no tab sees them again. */
    | { type: "dismiss-jobs"; ids: string[] }
    | { type: "show-dismiss-failed-toast"; count: number; message: string }
    | { type: "show-retry-failed-toast"; title: string; message: string }
    | {
        type: "show-job-succeeded-toast";
        jobId: string;
        title: string;
        /** Everything the toast says and links to, decided here. */
        toast: SucceededToast;
      }
    | {
        type: "show-job-failed-toast";
        jobId: string;
        kind: string;
        title: string;
        message: string;
        /** `false` when the sidecar never saw it (the enqueue failed): no log. */
        hasLog: boolean;
      }
    | { type: "show-sidecar-not-running-toast"; title: string }
    | {
        /**
         * Tell whoever asked for Job `id`: the server answered with the live
         * Job `jobId` instead, which does the same work. `id` never exists.
         */
        type: "report-job-joined";
        id: string;
        jobId: string;
      };
}

export const createInitialJobsState = (): jobsReducer.State => ({
  jobs: {},
  held: {},
  dismissed: {},
  sidecar: "unknown",
  sidecarMessage: null,
  timings: {},
  clockSkews: [],
  snapshotCursor: 0,
  joinedLate: {},
  fromCatchUp: {},
  stageHistory: {},
  stageHistoryRequest: 0,
});

/** The row id of one Video of a Batch export: `<job id>/<video id>`. */
export const batchVideoRowId = (jobId: string, videoId: string) =>
  `${jobId}/${videoId}`;

export const jobsReducer: EffectReducer<
  jobsReducer.State,
  jobsReducer.Action,
  jobsReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "job-requested": {
      const enqueue: jobsReducer.EnqueueJobEffect = {
        type: "enqueue-job",
        id: action.id,
        kind: action.kind,
        title: action.title,
        params: action.params,
        subject: action.subject,
        attemptsSpent: action.attemptsSpent,
        dependsOn: action.dependsOn,
        checks: 0,
        afterMs: 0,
      };
      // The server refuses a `dependsOn` it has not seen yet.
      const parent = action.dependsOn ? state.jobs[action.dependsOn] : null;
      const hold = parent !== null && parent !== undefined && !parent.enqueued;
      let held = state.held;
      if (hold && action.dependsOn) {
        held = {
          ...held,
          [action.dependsOn]: [...(held[action.dependsOn] ?? []), enqueue],
        };
      } else {
        exec(enqueue);
      }
      if (state.sidecar === "not-running") {
        exec({ type: "show-sidecar-not-running-toast", title: action.title });
      }
      return {
        ...state,
        held,
        jobs: {
          ...state.jobs,
          [action.id]: requestedJobView(action),
        },
      };
    }

    case "enqueue-succeeded":
    case "enqueue-failed":
    case "enqueue-unanswered":
      return reduceEnqueueOutcome(state, action, exec);

    case "press-retry": {
      const job = state.jobs[action.id];
      if (
        !job ||
        !isPostingJobKind(job.kind) ||
        (job.status !== "failed" && job.status !== "interrupted")
      ) {
        return state;
      }
      exec({ type: "retry-job", id: job.id, attempt: job.attempt });
      return state;
    }

    case "press-cancel":
    case "cancel-failed":
      return reduceCancel(state, action, exec);

    case "retry-failed": {
      const job = state.jobs[action.id];
      if (!job) return state;
      exec({
        type: "show-retry-failed-toast",
        title: job.title,
        message: action.message,
      });
      return state;
    }

    case "job-snapshot-received": {
      const jobs: Record<string, jobsReducer.JobView> = {};
      let timings: Record<string, UploadTiming> = {};
      for (const { job, events } of action.snapshot.jobs) {
        const folded = foldJobEvents(job, events);
        const view = folded.view;
        jobs[job.id] = view;
        timings = { ...timings, ...folded.timings };
        // A Job this tab was following settled while it was not listening:
        // that is still news, to the author and to anything waiting on it.
        const before = state.jobs[job.id];
        if (before && !isFinishedJob(before) && isFinishedJob(view)) {
          announceSettled(exec, view);
        }
      }
      // A request still on its way to the server is not in any snapshot yet.
      for (const job of Object.values(state.jobs)) {
        if (job.status === "requested" && !jobs[job.id]) jobs[job.id] = job;
      }
      // The Jobs that finished while no tab listened are in the history.
      return loadStageHistory(
        {
          ...state,
          jobs,
          timings,
          snapshotCursor: action.snapshot.cursor,
          joinedLate: {},
          fromCatchUp: {},
          sidecar: "running",
          sidecarMessage: null,
        },
        exec
      );
    }

    case "stage-history-loaded":
      if (action.requestId !== state.stageHistoryRequest) return state;
      return { ...state, stageHistory: stageHistoryFrom(action.history) };

    // The history in hand stays: it is only out of date by a run or two.
    case "stage-history-load-failed":
      return state;

    case "sidecar-available":
      return { ...state, sidecar: "running", sidecarMessage: null };

    case "sidecar-unavailable":
      return {
        ...state,
        sidecar: "not-running",
        sidecarMessage: action.message,
      };

    case "press-dismiss":
    case "press-clear-finished":
    case "idle-timeout-elapsed":
    case "dismiss-failed":
    case "job-dismissed":
      return reduceDismissal(state, action, exec);

    case "job-queued":
    case "job-started":
    case "job-stage-entered":
    case "job-progressed":
    case "job-retrying":
    case "job-requeued":
    case "job-succeeded":
    case "job-failed":
    case "job-interrupted":
    case "job-cancel-requested":
    case "job-cancelled":
    case "job-posted":
    case "job-result-reported":
    case "job-post-checked":
    case "job-submitted":
    case "job-published":
    case "batch-video-upload-queued":
    case "batch-video-upload-progressed":
    case "batch-videos-announced":
    case "batch-video-stage-entered":
    case "batch-video-progressed":
    case "batch-video-succeeded":
    case "batch-video-failed":
    case "batch-video-handed-off": {
      const before = state.jobs[action.job.id];
      const after = applyStreamAction(before, action);
      if (!after) return state;
      const caughtUp = action.eventId <= state.snapshotCursor;
      const settled =
        !(before && isFinishedJob(before)) && isFinishedJob(after);
      // Only a settlement heard live is news. The catch-up replays Jobs the
      // snapshot left out (finished, dismissed): not news. A Job this tab
      // knew unfinished settling is, even below the cursor (the newest id
      // visible then): a late commit (`job-event-feed.ts`) streams it after.
      const fromCatchUp =
        caughtUp &&
        (before === undefined || state.fromCatchUp[after.id] === true);
      if (!fromCatchUp) {
        if (settled) announceSettled(exec, after);
        announceVideoSettled(exec, after, action, before);
      }
      const late =
        state.joinedLate[after.id] === true ||
        (before === undefined && (caughtUp || action.type !== "job-queued"));
      const next: jobsReducer.State = {
        ...state,
        // An event is proof the sidecar is up.
        sidecar: "running",
        sidecarMessage: null,
        jobs: { ...state.jobs, [after.id]: after },
        timings: timeJobEvent(state.timings, before, after, action),
        clockSkews:
          late || caughtUp
            ? state.clockSkews
            : recordClockSkew(state.clockSkews, action),
        joinedLate:
          late && !state.joinedLate[after.id]
            ? { ...state.joinedLate, [after.id]: true }
            : state.joinedLate,
        fromCatchUp:
          fromCatchUp && !state.fromCatchUp[after.id]
            ? { ...state.fromCatchUp, [after.id]: true }
            : state.fromCatchUp,
      };
      // A Job that succeeded since the snapshot adds its stages to the
      // history: the snapshot's own load already had the older ones.
      return settled && !fromCatchUp && after.status === "succeeded"
        ? loadStageHistory(next, exec)
        : next;
    }
  }
};
