import type { EffectReducer } from "use-effect-reducer";
import type { jobsReducer } from "./jobs-reducer";

/**
 * What became of this tab's request to enqueue a Job: answered yes, answered
 * no, or never answered. Part of the jobs reducer.
 */

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

type EnqueueOutcome = Extract<
  jobsReducer.Action,
  { type: "enqueue-succeeded" | "enqueue-failed" | "enqueue-unanswered" }
>;

/**
 * What a row says while an enqueue goes unanswered: it may be queued already,
 * so it must not look failed — that would invite posting it a second time.
 */
export const ENQUEUE_UNCONFIRMED_MESSAGE =
  "Not confirmed yet — checking whether it was queued";

/** A Job this tab has asked for, before the sidecar reports it. */
export const requestedJobView = (
  action: Extract<jobsReducer.Action, { type: "job-requested" }>
): jobsReducer.JobView => ({
  id: action.id,
  kind: action.kind,
  title: action.title,
  subjectType: action.subject?.type ?? null,
  subjectId: action.subject?.id ?? null,
  status: "requested",
  attempt: action.attemptsSpent + 1,
  stage: null,
  percent: null,
  errorMessage: null,
  errorTag: null,
  dependsOn: action.dependsOn,
  createdAt: null,
  enqueued: false,
  result: null,
  postCheck: null,
  submitted: false,
  cancelRequested: false,
  lastEventId: 0,
  videos: null,
});

/** How long before asking again, after `checks` unanswered asks. */
const enqueueCheckDelayMs = (checks: number) =>
  Math.min(1_000 * 2 ** (checks - 1), 30_000);

/**
 * The Job is on the server. The row stays `requested` until the stream says
 * `queued`: the stream is the only word on a Job's state. What waited on it
 * may go now.
 */
const enqueued = (
  state: jobsReducer.State,
  id: string,
  exec: Exec
): jobsReducer.State => {
  const job = state.jobs[id];
  if (!job) return state;
  const { [id]: waiting = [], ...held } = state.held;
  for (const enqueue of waiting) exec(enqueue);
  return {
    ...state,
    held,
    jobs: { ...state.jobs, [job.id]: { ...job, enqueued: true } },
  };
};

/**
 * The server answered with a live Job that already does this work, and added
 * none: the request is dropped (its id will never be on the stream), and
 * whoever asked follows the live Job instead. Only a kind with one live Job
 * per piece of work (`transcribe-clips`) is answered this way, and nothing
 * waits on one.
 */
const joined = (
  state: jobsReducer.State,
  id: string,
  jobId: string,
  exec: Exec
): jobsReducer.State => {
  if (!state.jobs[id]) return state;
  exec({ type: "report-job-joined", id, jobId });
  const { [id]: _dropped, ...jobs } = state.jobs;
  return { ...state, jobs };
};

/** An enqueue that failed: it, and every Job held on it, fails here. */
const failRequested = (
  state: jobsReducer.State,
  id: string,
  message: string,
  exec: Exec
): jobsReducer.State => {
  const job = state.jobs[id];
  if (!job || job.status !== "requested") return state;
  const failed: jobsReducer.JobView = {
    ...job,
    status: "failed",
    errorMessage: message,
  };
  exec({
    type: "show-job-failed-toast",
    jobId: job.id,
    kind: job.kind,
    title: job.title,
    message,
    hasLog: false,
  });
  const { [id]: waiting = [], ...held } = state.held;
  let next: jobsReducer.State = {
    ...state,
    held,
    jobs: { ...state.jobs, [job.id]: failed },
  };
  for (const child of waiting) {
    next = failRequested(
      next,
      child.id,
      `Dependency "${job.title}" failed`,
      exec
    );
  }
  return next;
};

export const reduceEnqueueOutcome = (
  state: jobsReducer.State,
  action: EnqueueOutcome,
  exec: Exec
): jobsReducer.State => {
  switch (action.type) {
    case "enqueue-succeeded":
      return action.answeredBy === action.id
        ? enqueued(state, action.id, exec)
        : joined(state, action.id, action.answeredBy, exec);
    case "enqueue-failed":
      return failRequested(state, action.id, action.message, exec);
    case "enqueue-unanswered": {
      const job = state.jobs[action.enqueue.id];
      if (!job) return state;
      // The stream has already shown the Job: it was queued after all.
      if (job.status !== "requested") return enqueued(state, job.id, exec);
      // Enqueueing is idempotent on the id, so asking again is safe: it adds
      // the Job if the first ask never landed, and answers if it did.
      const checks = action.enqueue.checks + 1;
      exec({
        ...action.enqueue,
        checks,
        afterMs: enqueueCheckDelayMs(checks),
      });
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [job.id]: { ...job, errorMessage: ENQUEUE_UNCONFIRMED_MESSAGE },
        },
      };
    }
  }
};
