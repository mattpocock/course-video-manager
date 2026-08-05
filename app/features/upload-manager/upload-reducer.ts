import { uploadTypeRegistry } from "./upload-type-registry";
import {
  BUFFER_STAGE_BANDS,
  PUBLISH_STAGE_BANDS,
  PUBLISH_VIDEO_UPLOAD_BANDS,
  RENDER_VERTICAL_STAGE_BANDS,
  exportStageBands,
  fillBand,
  isSettled,
  streamedProgressBand,
  withDerivedParentProgress,
} from "./upload-progress";

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
  // The upload half of a per-Video task under a Publish. It follows the
  // export stages above: encode, then wait for a slot in the upload pool,
  // then move bytes.
  export type VideoUploadStage = "queued-for-upload" | "uploading";

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
    // The job this entry is a child task of — a Publish, for the per-Video
    // tasks it fans out into. Held in state rather than in a closure so
    // children render nested under their parent, are dismissed with it, and
    // can be aggregated into its progress.
    parentUploadId: string | null;
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
    // Set only for a per-Video task under a Publish, which carries on into
    // Dropbox once its encode is done. A standalone export has nowhere to
    // upload to and leaves these at their defaults.
    videoUploadStage: VideoUploadStage | null;
    uploadedBytes: number;
    // This Video's size on disk, known once the upload pool picks it up. It is
    // what weights the Video inside its parent's progress, so a 1.7 GB Video
    // does not count the same as a 200 MB one.
    totalBytes: number | null;
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
        parentUploadId?: string;
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
      }
    | {
        type: "UPDATE_VIDEO_UPLOAD_STAGE";
        uploadId: string;
        stage: VideoUploadStage;
      }
    | {
        // Bytes moving for one Video inside a Publish. `totalBytes` is its
        // size on disk and arrives with the first event, before any byte has
        // gone past.
        type: "UPDATE_VIDEO_UPLOAD_PROGRESS";
        uploadId: string;
        uploadedBytes: number;
        totalBytes: number;
      };
}

export const createInitialUploadState = (): uploadReducer.State => ({
  uploads: {},
});

export const uploadReducer = (
  state: uploadReducer.State,
  action: uploadReducer.Action
): uploadReducer.State => {
  const next = reduceUploads(state, action);
  if (next === state) return state;
  const uploads = withDerivedParentProgress(next.uploads);
  return uploads === next.uploads ? next : { ...next, uploads };
};

const reduceUploads = (
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
        parentUploadId: action.parentUploadId ?? null,
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
      // A Publish's bar is the aggregate of its per-Video children, so no
      // number streamed at the job as a whole may move it.
      if (upload.uploadType === "publish") return state;

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
              exportStageBands(upload)[action.stage].start
            ),
          },
        },
      };
    }

    case "UPDATE_EXPORT_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;

      const banded = fillBand(
        exportStageBands(upload)[action.stage],
        action.percent
      );

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

    case "UPDATE_VIDEO_UPLOAD_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;
      // The Dropbox commit is retried once server-side, which replays these
      // events for Videos that already landed. A settled task stays settled.
      if (isSettled(upload)) return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            // The encode is over — whatever stage it was left mid-way through
            // no longer describes this Video.
            exportStage: null,
            videoUploadStage: action.stage,
            progress: Math.max(
              upload.progress,
              PUBLISH_VIDEO_UPLOAD_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "UPDATE_VIDEO_UPLOAD_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;
      if (isSettled(upload)) return state;

      const percent =
        action.totalBytes > 0
          ? (action.uploadedBytes / action.totalBytes) * 100
          : 0;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            exportStage: null,
            videoUploadStage: "uploading",
            uploadedBytes: action.uploadedBytes,
            totalBytes: action.totalBytes,
            progress: Math.max(
              upload.progress,
              fillBand(PUBLISH_VIDEO_UPLOAD_BANDS.uploading, percent)
            ),
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
        parentUploadId: upload.parentUploadId,
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
      if (!state.uploads[action.uploadId]) return state;

      // Dismissing a parent takes its whole subtree with it. Children are only
      // ever rendered nested under their parent, so leaving them behind would
      // strand them in the list with nothing to belong to.
      const dismissed = new Set([action.uploadId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const upload of Object.values(state.uploads)) {
          if (dismissed.has(upload.uploadId)) continue;
          if (!upload.parentUploadId) continue;
          if (!dismissed.has(upload.parentUploadId)) continue;
          dismissed.add(upload.uploadId);
          grew = true;
        }
      }

      return {
        ...state,
        uploads: Object.fromEntries(
          Object.entries(state.uploads).filter(([id]) => !dismissed.has(id))
        ),
      };
    }

    default:
      return state;
  }
};
