import { uploadTypeRegistry } from "./upload-type-registry";

export namespace uploadReducer {
  export type UploadStatus =
    | "waiting"
    | "uploading"
    | "retrying"
    | "success"
    | "error";
  export type UploadType =
    | "youtube"
    | "buffer"
    | "ai-hero"
    | "skills-changelog"
    | "export"
    | "dropbox-publish"
    | "publish";
  export type BufferStage = "copying" | "syncing" | "sending-webhook";
  export type ExportStage =
    | "queued"
    | "concatenating-clips"
    | "normalizing-audio";
  export type PublishStage =
    | "validating"
    | "uploading"
    | "freezing"
    | "cloning";

  export interface BaseUploadEntry {
    uploadId: string;
    videoId: string;
    title: string;
    progress: number;
    status: UploadStatus;
    errorMessage: string | null;
    retryCount: number;
    dependsOn: string | null;
  }

  export interface YouTubeUploadEntry extends BaseUploadEntry {
    uploadType: "youtube";
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

  export interface DropboxPublishUploadEntry extends BaseUploadEntry {
    uploadType: "dropbox-publish";
    missingVideoCount: number | null;
  }

  export interface PublishUploadEntry extends BaseUploadEntry {
    uploadType: "publish";
    publishStage: PublishStage | null;
    newDraftVersionId: string | null;
    courseId: string;
  }

  export type UploadEntry =
    | YouTubeUploadEntry
    | BufferUploadEntry
    | AiHeroUploadEntry
    | SkillsChangelogUploadEntry
    | ExportUploadEntry
    | DropboxPublishUploadEntry
    | PublishUploadEntry;

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
        type: "UPLOAD_SUCCESS";
        uploadId: string;
        youtubeVideoId?: string;
        aiHeroSlug?: string;
        skillsChangelogSlug?: string;
      }
    | { type: "UPLOAD_ERROR"; uploadId: string; errorMessage: string }
    | { type: "RETRY"; uploadId: string }
    | { type: "DISMISS"; uploadId: string }
    | {
        type: "UPDATE_DROPBOX_PUBLISH_MISSING_COUNT";
        uploadId: string;
        missingVideoCount: number;
      }
    | {
        type: "UPDATE_PUBLISH_STAGE";
        uploadId: string;
        stage: PublishStage;
      }
    | {
        type: "PUBLISH_COMPLETE";
        uploadId: string;
        newDraftVersionId: string;
      };
}

export const createInitialUploadState = (): uploadReducer.State => ({
  uploads: {},
});

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
        dependsOn,
      };

      const config = uploadTypeRegistry[uploadType];
      if (config) {
        return {
          ...state,
          uploads: {
            ...state.uploads,
            [action.uploadId]: config.createEntry(base, action),
          },
        };
      }

      let entry: uploadReducer.UploadEntry;
      switch (uploadType) {
        case "ai-hero":
          entry = { ...base, uploadType: "ai-hero", aiHeroSlug: null };
          break;
        case "skills-changelog":
          entry = {
            ...base,
            uploadType: "skills-changelog",
            skillsChangelogSlug: null,
          };
          break;
        case "dropbox-publish":
          entry = {
            ...base,
            uploadType: "dropbox-publish",
            missingVideoCount: null,
          };
          break;
        case "publish":
          entry = {
            ...base,
            uploadType: "publish",
            publishStage: "validating",
            newDraftVersionId: null,
            courseId: action.courseId ?? "",
          };
          break;
        default:
          return state;
      }

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: entry,
        },
      };
    }

    case "UPDATE_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            progress: action.progress,
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
          },
        },
      };
    }

    case "UPDATE_EXPORT_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;

      const stageProgress: Record<uploadReducer.ExportStage, number> = {
        queued: 0,
        "concatenating-clips": 50,
        "normalizing-audio": 80,
      };

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            exportStage: action.stage,
            progress: stageProgress[action.stage],
          },
        },
      };
    }

    case "UPDATE_DROPBOX_PUBLISH_MISSING_COUNT": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "dropbox-publish") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            missingVideoCount: action.missingVideoCount,
          },
        },
      };
    }

    case "UPDATE_PUBLISH_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "publish") return state;

      const publishStageProgress: Record<uploadReducer.PublishStage, number> = {
        validating: 10,
        uploading: 40,
        freezing: 70,
        cloning: 90,
      };

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            publishStage: action.stage,
            progress: publishStageProgress[action.stage],
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

    case "UPLOAD_SUCCESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      let entry: uploadReducer.UploadEntry;
      const config = uploadTypeRegistry[upload.uploadType];
      if (config) {
        entry = config.applySuccess(upload, action);
      } else {
        const base = {
          ...upload,
          status: "success" as const,
          progress: 100,
          errorMessage: null,
        };

        switch (upload.uploadType) {
          case "ai-hero":
            entry = {
              ...base,
              uploadType: "ai-hero",
              aiHeroSlug: action.aiHeroSlug ?? null,
            };
            break;
          case "skills-changelog":
            entry = {
              ...base,
              uploadType: "skills-changelog",
              skillsChangelogSlug: action.skillsChangelogSlug ?? null,
            };
            break;
          case "dropbox-publish":
            entry = {
              ...base,
              uploadType: "dropbox-publish",
              missingVideoCount: upload.missingVideoCount,
            };
            break;
          case "publish":
            entry = {
              ...base,
              uploadType: "publish",
              publishStage: null,
              newDraftVersionId: upload.newDraftVersionId,
              courseId: upload.courseId,
            };
            break;
          default:
            entry = base as uploadReducer.UploadEntry;
        }
      }

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

    case "UPLOAD_ERROR": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const nextRetryCount = upload.retryCount + 1;

      if (nextRetryCount < 3) {
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
        dependsOn: upload.dependsOn,
      };

      const config = uploadTypeRegistry[upload.uploadType];
      if (config) {
        return {
          ...state,
          uploads: {
            ...state.uploads,
            [action.uploadId]: config.resetEntry(base, upload),
          },
        };
      }

      let entry: uploadReducer.UploadEntry;
      switch (upload.uploadType) {
        case "ai-hero":
          entry = { ...base, uploadType: "ai-hero", aiHeroSlug: null };
          break;
        case "skills-changelog":
          entry = {
            ...base,
            uploadType: "skills-changelog",
            skillsChangelogSlug: null,
          };
          break;
        case "dropbox-publish":
          entry = {
            ...base,
            uploadType: "dropbox-publish",
            missingVideoCount: null,
          };
          break;
        case "publish":
          entry = {
            ...base,
            uploadType: "publish",
            publishStage: "validating",
            newDraftVersionId: null,
            courseId: upload.courseId,
          };
          break;
        default:
          return state;
      }

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: entry,
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
