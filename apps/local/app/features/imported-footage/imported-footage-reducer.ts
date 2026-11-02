import type { EffectReducer } from "use-effect-reducer";
import type { jobsReducer } from "@/features/jobs/jobs-reducer";
import { TRANSCRIBE_FOOTAGE_JOB_KIND } from "@/features/jobs/transcribe-footage-job";

/**
 * THE IMPORTED FOOTAGE PAGE (#2537). The URL holds the search (`?q=`) and
 * the hit being played (`?play=<path>&t=<start>`); everything else the page
 * decides is here. The loader says which files have a fresh transcript; the
 * tab's Job Events say which are being transcribed now, so a row reads
 * "transcribing" live, and the page loads again once a transcription settles
 * (its transcript is written) or an import's file has landed (its
 * transcription has started running). Copy Path and Reveal in File System
 * are the rows' menu. Pure, no React.
 */
export namespace importedFootageReducer {
  /** A live `transcribe-footage` Job's file, and whether it has started. */
  export type Phase = "waiting" | "running";

  export interface State {
    /** Absolute path → its live transcription's phase. */
    transcriptions: Readonly<Record<string, Phase>>;
  }

  export type Action =
    | {
        type: "transcriptions-observed";
        live: Readonly<Record<string, Phase>>;
        /** The absolute paths the page lists now. */
        listed: readonly string[];
      }
    | { type: "copy-path-clicked"; path: string }
    | { type: "path-copied" }
    | { type: "copy-path-failed" }
    | { type: "reveal-clicked"; location: string; path: string }
    | { type: "reveal-failed"; message: string };

  export type Effect =
    | { type: "reload-footage" }
    | { type: "copy-path"; path: string }
    | { type: "reveal-file"; location: string; path: string }
    | { type: "show-toast"; tone: "success" | "error"; message: string };
}

export const createInitialImportedFootageState =
  (): importedFootageReducer.State => ({ transcriptions: {} });

/** How a file's transcript stands, as its row says it. */
export type TranscriptionState =
  "transcribed" | "transcribing" | "not-transcribed";

export const transcriptionStateOf = (
  state: importedFootageReducer.State,
  file: { absolute: string; transcribed: boolean }
): TranscriptionState =>
  file.transcribed
    ? "transcribed"
    : state.transcriptions[file.absolute] !== undefined
      ? "transcribing"
      : "not-transcribed";

/** The tab's live `transcribe-footage` Jobs, by file (their subject). */
export const liveTranscriptions = (
  jobs: readonly jobsReducer.JobView[]
): Record<string, importedFootageReducer.Phase> => {
  const live: Record<string, importedFootageReducer.Phase> = {};
  for (const job of jobs) {
    if (job.kind !== TRANSCRIBE_FOOTAGE_JOB_KIND || job.subjectId === null) {
      continue;
    }
    const phase = phaseOf(job.status);
    if (phase !== null) live[job.subjectId] = phase;
  }
  return live;
};

const phaseOf = (
  status: jobsReducer.JobStatus
): importedFootageReducer.Phase | null => {
  switch (status) {
    case "requested":
    case "queued":
      return "waiting";
    case "running":
    case "retrying":
      return "running";
    case "succeeded":
    case "failed":
    case "interrupted":
    case "cancelled":
      return null;
  }
};

export const importedFootageReducer: EffectReducer<
  importedFootageReducer.State,
  importedFootageReducer.Action,
  importedFootageReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "transcriptions-observed": {
      const before = state.transcriptions;
      const settled = Object.keys(before).some(
        (path) => action.live[path] === undefined
      );
      const landed = Object.entries(action.live).some(
        ([path, phase]) =>
          phase === "running" &&
          before[path] !== "running" &&
          !action.listed.includes(path)
      );
      if (settled || landed) exec({ type: "reload-footage" });
      return { ...state, transcriptions: action.live };
    }
    case "copy-path-clicked":
      exec({ type: "copy-path", path: action.path });
      return state;
    case "path-copied":
      exec({ type: "show-toast", tone: "success", message: "Path copied" });
      return state;
    case "copy-path-failed":
      exec({
        type: "show-toast",
        tone: "error",
        message: "Could not copy the path",
      });
      return state;
    case "reveal-clicked":
      exec({
        type: "reveal-file",
        location: action.location,
        path: action.path,
      });
      return state;
    case "reveal-failed":
      exec({
        type: "show-toast",
        tone: "error",
        message: `Could not show it in Explorer: ${action.message}`,
      });
      return state;
  }
};

/** The URL params that pick the hit being played. */
export const PLAY_PARAM = "play";
export const TIME_PARAM = "t";

/** The page's URL with this hit playing, keeping the search. */
export const withPlayer = (
  params: URLSearchParams,
  path: string,
  start: number
): string => {
  const next = new URLSearchParams(params);
  next.set(PLAY_PARAM, path);
  next.set(TIME_PARAM, String(start));
  return `?${next.toString()}`;
};

/** Whether two URLs differ only in the hit being played: nothing to load. */
export const onlyPlayerChanged = (current: URL, next: URL): boolean => {
  if (current.pathname !== next.pathname) return false;
  const rest = (url: URL) => {
    const params = new URLSearchParams(url.search);
    params.delete(PLAY_PARAM);
    params.delete(TIME_PARAM);
    params.sort();
    return params.toString();
  };
  return rest(current) === rest(next) && current.search !== next.search;
};
