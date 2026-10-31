import { useCallback, useEffect, useState } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import {
  decodeStreamData,
  EnqueueAnswer,
  jobCancelHref,
  jobRetryHref,
  JOBS_DISMISS_HREF,
  JOB_STREAM_EVENTS,
  JobEventMessage,
  JobSnapshotMessage,
  JobStageHistoryMessage,
  JOBS_STAGE_HISTORY_HREF,
  SidecarUnavailableMessage,
} from "./job-wire";
import {
  showDismissFailedToast,
  showJobFailedToast,
  showJobSucceededToast,
  showCancelFailedToast,
  showRetryFailedToast,
  showSidecarNotRunningToast,
} from "./job-toasts";
import { createJobEventHub, snapshotJobEvents } from "./job-event-hub";
import {
  LIVE_STREAM_CHANGED,
  LiveStreamHeard,
  liveStreamHeard,
} from "@/features/streaming/live-stream-wire";

type Dispatch = (action: jobsReducer.Action) => void;

/** A request this tab made that the server answered with another, live Job. */
export type JobJoinedReport = Extract<
  jobsReducer.Effect,
  { type: "report-job-joined" }
>;
export type JobJoinListener = (report: JobJoinedReport) => void;
/** Hear this tab's requests that joined a live Job; the result unsubscribes. */
export type SubscribeToJobJoins = (listener: JobJoinListener) => () => void;

/** The id of the Job an enqueue answered with (`{ id }`); `asked` if unreadable. */
const decodeEnqueueAnswer = (body: string, asked: string): string => {
  const answer = decodeStreamData(EnqueueAnswer, body);
  return answer?.id ?? asked;
};

export interface StartJobRequest {
  /**
   * The Job's id, when the caller has already named it (the editor's clip
   * reducer records its Clips against it); otherwise a fresh one.
   */
  id?: string;
  kind: string;
  title: string;
  params: Record<string, unknown>;
  subject: { type: string; id: string } | null;
  /** Attempts already spent before this became a Job (0 for new work). */
  attemptsSpent: number;
  /** A Job this one waits for (a post waits for its export), or `null`. */
  dependsOn: string | null;
}

/**
 * The bridge to the Sidecar's Job Event stream: one EventSource per tab,
 * which only dispatches what it hears, and passes each Job Event on to the
 * pages listening (`publish`). Closing it cancels nothing.
 */
function useJobEventStream(
  dispatch: Dispatch,
  publish: (heard: JobEventMessage) => void
) {
  useEffect(() => {
    const source = new EventSource("/api/jobs/events");
    source.addEventListener(JOB_STREAM_EVENTS.snapshot, (event) => {
      const snapshot = decodeStreamData(JobSnapshotMessage, event.data);
      if (!snapshot) return;
      dispatch({ type: "job-snapshot-received", snapshot });
      for (const heard of snapshotJobEvents(snapshot)) publish(heard);
    });
    source.addEventListener(JOB_STREAM_EVENTS.jobEvent, (event) => {
      const message = decodeStreamData(JobEventMessage, event.data);
      if (!message) return;
      const action = toJobsAction(message, Date.now());
      if (action) dispatch(action);
      publish(message);
    });
    source.addEventListener(JOB_STREAM_EVENTS.sidecarAvailable, () =>
      dispatch({ type: "sidecar-available" })
    );
    source.addEventListener(JOB_STREAM_EVENTS.sidecarUnavailable, (event) => {
      const unavailable = decodeStreamData(
        SidecarUnavailableMessage,
        event.data
      );
      if (unavailable) {
        dispatch({ type: "sidecar-unavailable", message: unavailable.message });
      }
    });
    // The app server's word on the Live Stream rides on this stream too.
    source.addEventListener(LIVE_STREAM_CHANGED, (event) => {
      const heard = decodeStreamData(LiveStreamHeard, event.data);
      if (heard !== undefined) liveStreamHeard(heard);
    });
    return () => source.close();
  }, [dispatch, publish]);
}

/**
 * This tab's view of the background Jobs, and the one way it starts one.
 * `subscribeToJobEvents` lets a page hear Job Events itself (the editor hears
 * its Clip transcriptions).
 */
export function useJobs() {
  const [joinListeners] = useState(() => new Set<JobJoinListener>());

  const [state, dispatch] = useEffectReducer<
    jobsReducer.State,
    jobsReducer.Action,
    jobsReducer.Effect
  >(jobsReducer, createInitialJobsState(), {
    "enqueue-job": (_state, effect, dispatch) => {
      const send = () =>
        fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: effect.id,
            kind: effect.kind,
            title: effect.title,
            params: effect.params,
            subject: effect.subject,
            attemptsSpent: effect.attemptsSpent,
            dependsOn: effect.dependsOn,
          }),
        })
          .then(async (response) => {
            if (response.ok) {
              dispatch({
                type: "enqueue-succeeded",
                id: effect.id,
                answeredBy: decodeEnqueueAnswer(
                  await response.text(),
                  effect.id
                ),
              });
            } else if (response.status < 500) {
              dispatch({
                type: "enqueue-failed",
                id: effect.id,
                message: `Could not queue it: ${(await response.text()) || `the server answered ${response.status}`}`,
              });
            } else {
              dispatch({
                type: "enqueue-unanswered",
                enqueue: effect,
                message: `The server answered ${response.status}`,
              });
            }
          })
          .catch((error: unknown) =>
            dispatch({
              type: "enqueue-unanswered",
              enqueue: effect,
              message: error instanceof Error ? error.message : String(error),
            })
          );
      if (effect.afterMs === 0) {
        void send();
        return;
      }
      const timer = setTimeout(() => void send(), effect.afterMs);
      return () => clearTimeout(timer);
    },
    "cancel-job": (_state, effect, dispatch) => {
      fetch(jobCancelHref(effect.id), { method: "POST" })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              (await response.text()) ||
                `The server answered ${response.status}`
            );
          }
          // The stream brings `cancel-requested`, then `cancelled`.
        })
        .catch((error: unknown) =>
          dispatch({
            type: "cancel-failed",
            id: effect.id,
            message: error instanceof Error ? error.message : String(error),
          })
        );
    },
    "retry-job": (_state, effect, dispatch) => {
      fetch(jobRetryHref(effect.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempt: effect.attempt }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              (await response.text()) ||
                `The server answered ${response.status}`
            );
          }
          // The stream brings the re-queued Job; nothing to do here.
        })
        .catch((error: unknown) =>
          dispatch({
            type: "retry-failed",
            id: effect.id,
            message: error instanceof Error ? error.message : String(error),
          })
        );
    },
    "dismiss-jobs": (_state, effect, dispatch) => {
      fetch(JOBS_DISMISS_HREF, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: effect.ids }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              (await response.text()) ||
                `The server answered ${response.status}`
            );
          }
          // The stream brings the `dismissed` events to every tab.
        })
        .catch((error: unknown) =>
          dispatch({
            type: "dismiss-failed",
            ids: effect.ids,
            message: error instanceof Error ? error.message : String(error),
          })
        );
    },
    "load-stage-history": (_state, effect, dispatch) => {
      const controller = new AbortController();
      fetch(JOBS_STAGE_HISTORY_HREF, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`The server answered ${response.status}`);
          }
          const history = decodeStreamData(
            JobStageHistoryMessage,
            await response.text()
          );
          if (!history) throw new Error("Unreadable stage history");
          dispatch({
            type: "stage-history-loaded",
            requestId: effect.requestId,
            history,
          });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          dispatch({
            type: "stage-history-load-failed",
            requestId: effect.requestId,
          });
        });
      return () => controller.abort();
    },
    "show-dismiss-failed-toast": (_state, effect) =>
      showDismissFailedToast(effect),
    "show-retry-failed-toast": (_state, effect) => showRetryFailedToast(effect),
    "show-cancel-failed-toast": (_state, effect) =>
      showCancelFailedToast(effect),
    "show-job-succeeded-toast": (_state, effect) =>
      showJobSucceededToast(effect),
    "show-job-failed-toast": (_state, effect) => showJobFailedToast(effect),
    "show-sidecar-not-running-toast": (_state, effect) =>
      showSidecarNotRunningToast(effect),
    "report-job-joined": (_state, effect) => {
      for (const listener of joinListeners) listener(effect);
    },
  });

  const [hub] = useState(createJobEventHub);

  const subscribeToJobJoins = useCallback((listener: JobJoinListener) => {
    joinListeners.add(listener);
    return () => {
      joinListeners.delete(listener);
    };
  }, []);
  useJobEventStream(dispatch, hub.publish);

  const startJob = useCallback(
    ({ id = crypto.randomUUID(), ...request }: StartJobRequest): string => {
      dispatch({ type: "job-requested", id, ...request });
      return id;
    },
    [dispatch]
  );

  const dismissJob = useCallback(
    (id: string) => dispatch({ type: "press-dismiss", id }),
    [dispatch]
  );

  const retryJob = useCallback(
    (id: string) => dispatch({ type: "press-retry", id }),
    [dispatch]
  );

  const cancelJob = useCallback(
    (id: string) => dispatch({ type: "press-cancel", id }),
    [dispatch]
  );

  const dismissFinishedJobs = useCallback(
    () => dispatch({ type: "idle-timeout-elapsed" }),
    [dispatch]
  );

  const clearFinishedJobs = useCallback(
    () => dispatch({ type: "press-clear-finished" }),
    [dispatch]
  );

  return {
    state,
    startJob,
    subscribeToJobEvents: hub.subscribe,
    subscribeToJobJoins,
    dismissJob,
    retryJob,
    cancelJob,
    dismissFinishedJobs,
    clearFinishedJobs,
  };
}
