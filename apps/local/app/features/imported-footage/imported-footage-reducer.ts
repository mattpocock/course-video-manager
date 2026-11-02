import type { EffectReducer } from "use-effect-reducer";
import type { jobsReducer } from "@/features/jobs/jobs-reducer";
import { TRANSCRIBE_FOOTAGE_JOB_KIND } from "@/features/jobs/transcribe-footage-job";
import { IMPORT_YOUTUBE_FOOTAGE_JOB_KIND } from "@/features/jobs/import-youtube-footage-job";

/**
 * THE IMPORTED FOOTAGE PAGE (#2537). The URL holds the search (`?q=`) and
 * the hit being played (`?play=<path>&t=<start>`); everything else the page
 * decides is here. The loader says which files have a fresh transcript; the
 * tab's Job Events say which are being transcribed now, so a row reads
 * "transcribing" live, and the page loads again once a transcription settles
 * (its transcript is written) or an import's file has landed (its
 * transcription has started running). The URL box starts a YouTube import
 * (#2545); its live downloads show with their progress, and the page loads
 * again once one ends. Copy Path and Reveal in File System are the rows'
 * menu. Pure, no React.
 */
export namespace importedFootageReducer {
  /** A live `transcribe-footage` Job's file, and whether it has started. */
  export type Phase = "waiting" | "running";

  /** A live `import-youtube-footage` Job, as the page shows it. */
  export interface Download {
    videoId: string;
    stage: string | null;
    percent: number | null;
  }

  export interface State {
    /** Absolute path → its live transcription's phase. */
    transcriptions: Readonly<Record<string, Phase>>;
    /** Job id → its live YouTube download. */
    downloads: Readonly<Record<string, Download>>;
    /** The URL being sent to start an import; the box waits meanwhile. */
    startingUrl: string | null;
    /** Bumped when an import starts: the URL box is emptied. */
    urlBoxGeneration: number;
  }

  export type Action =
    | {
        type: "transcriptions-observed";
        live: Readonly<Record<string, Phase>>;
        /** The absolute paths the page lists now. */
        listed: readonly string[];
      }
    | {
        type: "downloads-observed";
        live: Readonly<Record<string, Download>>;
      }
    | { type: "youtube-url-submitted"; url: string }
    | {
        type: "youtube-import-started";
        videoId: string;
        jobId: string | null;
        path: string | null;
      }
    | { type: "youtube-import-refused"; message: string }
    | { type: "copy-path-clicked"; path: string }
    | { type: "path-copied" }
    | { type: "copy-path-failed" }
    | { type: "reveal-clicked"; location: string; path: string }
    | { type: "reveal-failed"; message: string };

  export type Effect =
    | { type: "reload-footage" }
    | { type: "start-youtube-import"; url: string }
    | { type: "copy-path"; path: string }
    | { type: "reveal-file"; location: string; path: string }
    | { type: "show-toast"; tone: "success" | "error"; message: string };
}

export const createInitialImportedFootageState =
  (): importedFootageReducer.State => ({
    transcriptions: {},
    downloads: {},
    startingUrl: null,
    urlBoxGeneration: 0,
  });

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

/** The tab's live YouTube downloads, by Job id. */
export const liveDownloads = (
  jobs: readonly jobsReducer.JobView[]
): Record<string, importedFootageReducer.Download> => {
  const live: Record<string, importedFootageReducer.Download> = {};
  for (const job of jobs) {
    if (job.kind !== IMPORT_YOUTUBE_FOOTAGE_JOB_KIND) continue;
    if (phaseOf(job.status) === null) continue;
    live[job.id] = {
      videoId: job.subjectId ?? "",
      stage: job.stage,
      percent: job.percent,
    };
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
    case "downloads-observed": {
      const ended = Object.keys(state.downloads).some(
        (jobId) => action.live[jobId] === undefined
      );
      if (ended) exec({ type: "reload-footage" });
      return { ...state, downloads: action.live };
    }
    case "youtube-url-submitted": {
      const url = action.url.trim();
      if (url === "" || state.startingUrl !== null) return state;
      exec({ type: "start-youtube-import", url });
      return { ...state, startingUrl: url };
    }
    case "youtube-import-started":
      if (action.jobId === null) {
        exec({
          type: "show-toast",
          tone: "success",
          message: `Already imported: ${action.path ?? action.videoId}`,
        });
      }
      return {
        ...state,
        startingUrl: null,
        urlBoxGeneration: state.urlBoxGeneration + 1,
      };
    case "youtube-import-refused":
      exec({
        type: "show-toast",
        tone: "error",
        message: `Could not import it: ${action.message}`,
      });
      return { ...state, startingUrl: null };
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
