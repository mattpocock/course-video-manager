import { uploadTypeRegistry } from "./upload-type-registry";

export namespace uploadReducer {
  export type UploadStatus =
    "waiting" | "uploading" | "retrying" | "success" | "error";
  export type UploadType =
    | "youtube"
    | "youtube-shorts"
    | "buffer"
    | "ai-hero"
    | "skills-changelog"
    | "export"
    | "publish"
    | "render-vertical";
  export type BufferStage =
    "uploading-blob" | "creating-post" | "polling" | "cleaning-up";
  export type ExportStage =
    "queued" | "concatenating-clips" | "normalizing-audio";
  export type RenderVerticalStage =
    | "concatenating-clips"
    | "transcribing"
    | "rendering-overlay"
    | "compositing";
  export type PublishStage =
    "validating" | "exporting" | "uploading" | "freezing" | "cloning";

  export interface BaseUploadEntry {
    uploadId: string;
    videoId: string;
    title: string;
    progress: number;
    status: UploadStatus;
    errorMessage: string | null;
    retryCount: number;
    // When set, this entry has failed terminally and must never be
    // auto-retried, independent of how many attempts `retryCount` has counted.
    terminal: boolean;
    dependsOn: string | null;
  }

  export interface YouTubeUploadEntry extends BaseUploadEntry {
    uploadType: "youtube";
    youtubeVideoId: string | null;
  }

  export interface YouTubeShortsUploadEntry extends BaseUploadEntry {
    uploadType: "youtube-shorts";
    youtubeVideoId: string | null;
  }

  export interface BufferUploadEntry extends BaseUploadEntry {
    uploadType: "buffer";
    bufferStage: BufferStage | null;
  }

  export interface AiHeroUploadEntry extends BaseUploadEntry {
    uploadType: "ai-hero";
    aiHeroSlug: string | null;
  }

  export interface SkillsChangelogUploadEntry extends BaseUploadEntry {
    uploadType: "skills-changelog";
    skillsChangelogSlug: string | null;
  }

  export interface ExportUploadEntry extends BaseUploadEntry {
    uploadType: "export";
    exportStage: ExportStage | null;
    isBatchEntry: boolean;
  }

  export interface PublishUploadEntry extends BaseUploadEntry {
    uploadType: "publish";
    publishStage: PublishStage | null;
    newDraftVersionId: string | null;
    courseId: string;
  }

  export interface RenderVerticalUploadEntry extends BaseUploadEntry {
    uploadType: "render-vertical";
    renderVerticalStage: RenderVerticalStage | null;
  }

  export type UploadEntry =
    | YouTubeUploadEntry
    | YouTubeShortsUploadEntry
    | BufferUploadEntry
    | AiHeroUploadEntry
    | SkillsChangelogUploadEntry
    | ExportUploadEntry
    | PublishUploadEntry
    | RenderVerticalUploadEntry;

  export interface State {
    uploads: Record<string, UploadEntry>;
  }

  export type Action =
    | {
        type: "START_UPLOAD";
        uploadId: string;
        videoId: string;
        title: string;
        uploadType?: UploadType;
        dependsOn?: string;
        isBatchEntry?: boolean;
        courseId?: string;
      }
    | { type: "UPDATE_PROGRESS"; uploadId: string; progress: number }
    | {
        type: "UPDATE_BUFFER_STAGE";
        uploadId: string;
        stage: BufferStage;
      }
    | {
        type: "UPDATE_EXPORT_STAGE";
        uploadId: string;
        stage: ExportStage;
      }
    | {
        // Real ffmpeg progress within an export stage (integer 0–99, resets
        // per stage) — banded into the single bar: concatenating 0–80,
        // normalizing 80–99.
        type: "UPDATE_EXPORT_PROGRESS";
        uploadId: string;
        stage: Exclude<ExportStage, "queued">;
        percent: number;
      }
    | {
        type: "UPLOAD_SUCCESS";
        uploadId: string;
        youtubeVideoId?: string;
        aiHeroSlug?: string;
        skillsChangelogSlug?: string;
      }
    | { type: "UPLOAD_ERROR"; uploadId: string; errorMessage: string }
    | { type: "UPLOAD_FATAL_ERROR"; uploadId: string; errorMessage: string }
    | { type: "RETRY"; uploadId: string }
    | { type: "DISMISS"; uploadId: string }
    | {
        type: "UPDATE_PUBLISH_STAGE";
        uploadId: string;
        stage: PublishStage;
      }
    | {
        type: "PUBLISH_COMPLETE";
        uploadId: string;
        newDraftVersionId: string;
      }
    | {
        type: "UPDATE_RENDER_VERTICAL_STAGE";
        uploadId: string;
        stage: RenderVerticalStage;
      };
}

export const createInitialUploadState = (): uploadReducer.State => ({
  uploads: {},
});

interface StageBand {
  start: number;
  width: number;
}

// Every job type divides its single bar into one band per stage: the stage
// change jumps to `start`, then any real percentage the stage streams fills
// `width` of that band. A stage with `width: 0` reports no measurable progress
// and simply parks the bar at `start`. 100 is reserved for completion
// (UPLOAD_SUCCESS).
const EXPORT_STAGE_BANDS: Record<uploadReducer.ExportStage, StageBand> = {
  queued: { start: 0, width: 0 },
  "concatenating-clips": { start: 0, width: 80 },
  "normalizing-audio": { start: 80, width: 19 },
};

// Only the blob upload streams a real byte percentage; Buffer's own pipeline
// gives us stage transitions and nothing finer.
const BUFFER_STAGE_BANDS: Record<uploadReducer.BufferStage, StageBand> = {
  "uploading-blob": { start: 0, width: 50 },
  "creating-post": { start: 50, width: 0 },
  polling: { start: 70, width: 0 },
  "cleaning-up": { start: 90, width: 0 },
};

// Only the Dropbox commit ("uploading") reports a real per-lesson percentage.
const PUBLISH_STAGE_BANDS: Record<uploadReducer.PublishStage, StageBand> = {
  validating: { start: 5, width: 0 },
  exporting: { start: 20, width: 0 },
  uploading: { start: 40, width: 35 },
  freezing: { start: 75, width: 0 },
  cloning: { start: 90, width: 0 },
};

const RENDER_VERTICAL_STAGE_BANDS: Record<
  uploadReducer.RenderVerticalStage,
  StageBand
> = {
  "concatenating-clips": { start: 10, width: 0 },
  transcribing: { start: 30, width: 0 },
  "rendering-overlay": { start: 60, width: 0 },
  compositing: { start: 85, width: 0 },
};

/** Where in the bar `percent` (0–100, within the stage) lands. */
const fillBand = (band: StageBand, percent: number) =>
  band.start + Math.floor((percent / 100) * band.width);

/**
 * The band a raw `UPDATE_PROGRESS` percentage belongs to. `null` when the job
 * streams a real percentage for its whole life rather than per stage, in which
 * case the percentage already *is* the bar position.
 */
const streamedProgressBand = (
  upload: uploadReducer.UploadEntry
): StageBand | null => {
  if (upload.uploadType === "buffer" && upload.bufferStage) {
    return BUFFER_STAGE_BANDS[upload.bufferStage];
  }
  if (upload.uploadType === "publish" && upload.publishStage) {
    return PUBLISH_STAGE_BANDS[upload.publishStage];
  }
  return null;
};

export const uploadReducer = (
  state: uploadReducer.State,
  action: uploadReducer.Action
): uploadReducer.State => {
  switch (action.type) {
    case "START_UPLOAD": {
      const uploadType = action.uploadType ?? "youtube";
      const dependsOn = action.dependsOn ?? null;
      const status = dependsOn ? ("waiting" as const) : ("uploading" as const);
      const base: uploadReducer.BaseUploadEntry = {
        uploadId: action.uploadId,
        videoId: action.videoId,
        title: action.title,
        progress: 0,
        status,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn,
      };

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: uploadTypeRegistry[uploadType].createEntry(
            base,
            action
          ),
        },
      };
    }

    case "UPDATE_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const band = streamedProgressBand(upload);

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            // Monotonic, like UPDATE_EXPORT_PROGRESS: a stage that streams a
            // real percentage fills its own band, so finishing one stage can
            // never drag the bar back below where the next stage starts.
            progress: Math.max(
              upload.progress,
              band ? fillBand(band, action.progress) : action.progress
            ),
          },
        },
      };
    }

    case "UPDATE_BUFFER_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "buffer") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            bufferStage: action.stage,
            progress: Math.max(
              upload.progress,
              BUFFER_STAGE_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "UPDATE_EXPORT_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            exportStage: action.stage,
            progress: Math.max(
              upload.progress,
              EXPORT_STAGE_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "UPDATE_EXPORT_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;

      const banded = fillBand(EXPORT_STAGE_BANDS[action.stage], action.percent);

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            exportStage: action.stage,
            // Monotonic: a late event from the previous phase never drags the
            // bar backwards.
            progress: Math.max(upload.progress, banded),
          },
        },
      };
    }

    case "UPDATE_PUBLISH_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "publish") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            publishStage: action.stage,
            progress: Math.max(
              upload.progress,
              PUBLISH_STAGE_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "PUBLISH_COMPLETE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "publish") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            newDraftVersionId: action.newDraftVersionId,
          },
        },
      };
    }

    case "UPDATE_RENDER_VERTICAL_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "render-vertical") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            renderVerticalStage: action.stage,
            progress: Math.max(
              upload.progress,
              RENDER_VERTICAL_STAGE_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "UPLOAD_SUCCESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const entry: uploadReducer.UploadEntry = uploadTypeRegistry[
        upload.uploadType
      ].applySuccess(upload, action);

      // Activate any jobs waiting on this upload
      const updatedUploads = { ...state.uploads, [action.uploadId]: entry };
      for (const [id, u] of Object.entries(updatedUploads)) {
        if (u.dependsOn === action.uploadId && u.status === "waiting") {
          updatedUploads[id] = { ...u, status: "uploading" };
        }
      }

      return {
        ...state,
        uploads: updatedUploads,
      };
    }

    case "UPLOAD_FATAL_ERROR": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const updatedUploads = {
        ...state.uploads,
        [action.uploadId]: {
          ...upload,
          status: "error" as const,
          terminal: true,
          errorMessage: action.errorMessage,
        },
      };
      for (const [id, candidate] of Object.entries(updatedUploads)) {
        if (
          candidate.dependsOn === action.uploadId &&
          candidate.status === "waiting"
        ) {
          updatedUploads[id] = {
            ...candidate,
            status: "error" as const,
            errorMessage: `Dependency "${upload.title}" failed`,
          };
        }
      }
      return { ...state, uploads: updatedUploads };
    }

    case "UPLOAD_ERROR": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const nextRetryCount = upload.retryCount + 1;

      if (nextRetryCount < 3 && !upload.terminal) {
        return {
          ...state,
          uploads: {
            ...state.uploads,
            [action.uploadId]: {
              ...upload,
              status: "retrying",
              retryCount: nextRetryCount,
              errorMessage: action.errorMessage,
            },
          },
        };
      }

      // Final failure — also fail any jobs waiting on this upload
      const updatedUploads = {
        ...state.uploads,
        [action.uploadId]: {
          ...upload,
          status: "error" as const,
          retryCount: nextRetryCount,
          errorMessage: action.errorMessage,
        },
      };
      for (const [id, u] of Object.entries(updatedUploads)) {
        if (u.dependsOn === action.uploadId && u.status === "waiting") {
          updatedUploads[id] = {
            ...u,
            status: "error" as const,
            errorMessage: `Dependency "${upload.title}" failed`,
          };
        }
      }

      return {
        ...state,
        uploads: updatedUploads,
      };
    }

    case "RETRY": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const base: uploadReducer.BaseUploadEntry = {
        uploadId: upload.uploadId,
        videoId: upload.videoId,
        title: upload.title,
        progress: 0,
        status: "uploading" as const,
        errorMessage: upload.errorMessage,
        retryCount: upload.retryCount,
        terminal: upload.terminal,
        dependsOn: upload.dependsOn,
      };

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: uploadTypeRegistry[upload.uploadType].resetEntry(
            base,
            upload
          ),
        },
      };
    }

    case "DISMISS": {
      const { [action.uploadId]: _, ...remaining } = state.uploads;
      return {
        ...state,
        uploads: remaining,
      };
    }

    default:
      return state;
  }
};
