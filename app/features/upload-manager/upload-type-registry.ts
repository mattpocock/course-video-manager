import type { uploadReducer } from "./upload-reducer";
import { startSSEAiHeroPost } from "./sse-ai-hero-client";
import { startSSEExport } from "./sse-export-client";
import { startSSEPublish } from "./sse-publish-client";
import { startSSERenderVertical } from "./sse-render-vertical-client";
import { startSSESkillsChangelogPost } from "./sse-skills-changelog-client";
import { startSSESocialPost } from "./sse-social-client";
import { startSSEUpload } from "./sse-upload-client";
import { startSSEYoutubeShortsPost } from "./sse-youtube-shorts-client";

type StartUploadAction = Extract<
  uploadReducer.Action,
  { type: "START_UPLOAD" }
>;
type UploadSuccessAction = Extract<
  uploadReducer.Action,
  { type: "UPLOAD_SUCCESS" }
>;

export interface UploadTypeConfig<
  TParams = unknown,
  TEntry extends uploadReducer.UploadEntry = uploadReducer.UploadEntry,
> {
  createEntry: (
    base: uploadReducer.BaseUploadEntry,
    action: StartUploadAction
  ) => TEntry;

  resetEntry: (
    base: uploadReducer.BaseUploadEntry,
    prevEntry: TEntry
  ) => TEntry;

  applySuccess: (entry: TEntry, action: UploadSuccessAction) => TEntry;

  initiate: (
    uploadId: string,
    entry: TEntry,
    params: TParams,
    dispatch: (action: uploadReducer.Action) => void,
    abortControllers: Map<string, AbortController>
  ) => void;

  supportsDependsOn?: boolean;
}

export function withAbortManagement(
  uploadId: string,
  abortControllers: Map<string, AbortController>,
  start: () => AbortController
): void {
  const existing = abortControllers.get(uploadId);
  if (existing) existing.abort();
  const controller = start();
  abortControllers.set(uploadId, controller);
}

const exportConfig: UploadTypeConfig<
  undefined,
  uploadReducer.ExportUploadEntry
> = {
  createEntry: (base, action) => ({
    ...base,
    uploadType: "export" as const,
    exportStage: "queued" as const,
    isBatchEntry: action.isBatchEntry ?? false,
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "export" as const,
    exportStage: "queued" as const,
    isBatchEntry: prev.isBatchEntry,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    exportStage: null,
  }),

  initiate: (uploadId, entry, _params, dispatch, abortControllers) => {
    withAbortManagement(uploadId, abortControllers, () =>
      startSSEExport(
        { videoId: entry.videoId },
        {
          onStageChange: (stage) => {
            dispatch({ type: "UPDATE_EXPORT_STAGE", uploadId, stage });
          },
          onProgress: (stage, percent) => {
            if (stage === "queued") return;
            dispatch({
              type: "UPDATE_EXPORT_PROGRESS",
              uploadId,
              stage,
              percent,
            });
          },
          onComplete: () => {
            dispatch({ type: "UPLOAD_SUCCESS", uploadId });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: false,
};

export interface YouTubeParams {
  description: string;
  privacyStatus: "public" | "unlisted";
  thumbnailId: string;
}

const youtubeConfig: UploadTypeConfig<
  YouTubeParams,
  uploadReducer.YouTubeUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "youtube" as const,
    youtubeVideoId: null,
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "youtube" as const,
    youtubeVideoId: prev.youtubeVideoId,
  }),

  applySuccess: (entry, action) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    youtubeVideoId: action.youtubeVideoId ?? null,
  }),

  initiate: (uploadId, entry, params, dispatch, abortControllers) => {
    withAbortManagement(uploadId, abortControllers, () =>
      startSSEUpload(
        {
          videoId: entry.videoId,
          title: entry.title,
          description: params.description,
          privacyStatus: params.privacyStatus,
          thumbnailId: params.thumbnailId,
        },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onComplete: (youtubeVideoId) => {
            dispatch({ type: "UPLOAD_SUCCESS", uploadId, youtubeVideoId });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: true,
};

export interface YouTubeShortsParams {
  description: string;
}

const youtubeShortsConfig: UploadTypeConfig<
  YouTubeShortsParams,
  uploadReducer.YouTubeShortsUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "youtube-shorts" as const,
    youtubeVideoId: null,
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "youtube-shorts" as const,
    youtubeVideoId: prev.youtubeVideoId,
  }),

  applySuccess: (entry, action) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    youtubeVideoId: action.youtubeVideoId ?? null,
  }),

  initiate: (uploadId, entry, params, dispatch, abortControllers) => {
    withAbortManagement(uploadId, abortControllers, () =>
      startSSEYoutubeShortsPost(
        {
          videoId: entry.videoId,
          title: entry.title,
          description: params.description,
        },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onComplete: (youtubeVideoId) => {
            dispatch({ type: "UPLOAD_SUCCESS", uploadId, youtubeVideoId });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: true,
};

export interface BufferParams {
  caption: string;
}

const bufferConfig: UploadTypeConfig<
  BufferParams,
  uploadReducer.BufferUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "buffer" as const,
    bufferStage: "uploading-blob" as const,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "buffer" as const,
    bufferStage: "uploading-blob" as const,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    bufferStage: null,
  }),

  initiate: (uploadId, entry, params, dispatch, abortControllers) => {
    withAbortManagement(uploadId, abortControllers, () =>
      startSSESocialPost(
        { videoId: entry.videoId, caption: params.caption },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onStageChange: (stage) => {
            dispatch({ type: "UPDATE_BUFFER_STAGE", uploadId, stage });
          },
          onComplete: () => {
            dispatch({ type: "UPLOAD_SUCCESS", uploadId });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: true,
};

export interface AiHeroParams {
  body: string;
  description: string;
  slug: string;
}

const aiHeroConfig: UploadTypeConfig<
  AiHeroParams,
  uploadReducer.AiHeroUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "ai-hero" as const,
    aiHeroSlug: null,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "ai-hero" as const,
    aiHeroSlug: null,
  }),

  applySuccess: (entry, action) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    aiHeroSlug: action.aiHeroSlug ?? null,
  }),

  initiate: (uploadId, entry, params, dispatch, abortControllers) => {
    withAbortManagement(uploadId, abortControllers, () =>
      startSSEAiHeroPost(
        {
          videoId: entry.videoId,
          title: entry.title,
          body: params.body,
          description: params.description,
          slug: params.slug,
        },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onComplete: (aiHeroSlug) => {
            dispatch({ type: "UPLOAD_SUCCESS", uploadId, aiHeroSlug });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: true,
};

export interface SkillsChangelogParams {
  slug: string;
  body: string;
  description: string;
  newsletterSubject: string;
  newsletterPreviewText: string;
  newsletterCopy: string;
}

const skillsChangelogConfig: UploadTypeConfig<
  SkillsChangelogParams,
  uploadReducer.SkillsChangelogUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "skills-changelog" as const,
    skillsChangelogSlug: null,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "skills-changelog" as const,
    skillsChangelogSlug: null,
  }),

  applySuccess: (entry, action) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    skillsChangelogSlug: action.skillsChangelogSlug ?? null,
  }),

  initiate: (uploadId, entry, params, dispatch, abortControllers) => {
    withAbortManagement(uploadId, abortControllers, () =>
      startSSESkillsChangelogPost(
        {
          videoId: entry.videoId,
          title: entry.title,
          slug: params.slug,
          body: params.body,
          description: params.description,
          newsletterSubject: params.newsletterSubject,
          newsletterPreviewText: params.newsletterPreviewText,
          newsletterCopy: params.newsletterCopy,
        },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onComplete: (skillsChangelogSlug) => {
            dispatch({
              type: "UPLOAD_SUCCESS",
              uploadId,
              skillsChangelogSlug,
            });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: true,
};

export interface PublishParams {
  courseId: string;
  name: string;
  description: string;
  includeTodoLessons: boolean;
}

const publishConfig: UploadTypeConfig<
  PublishParams,
  uploadReducer.PublishUploadEntry
> = {
  createEntry: (base, action) => ({
    ...base,
    uploadType: "publish" as const,
    publishStage: "validating" as const,
    newDraftVersionId: null,
    courseId: action.courseId ?? "",
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "publish" as const,
    publishStage: "validating" as const,
    newDraftVersionId: null,
    courseId: prev.courseId,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    publishStage: null,
    newDraftVersionId: entry.newDraftVersionId,
    courseId: entry.courseId,
  }),

  initiate: (uploadId, _entry, params, dispatch, abortControllers) => {
    // videoId → uploadId for the per-video export entries this publish spawns.
    // They render exactly like standalone batch-export entries.
    const exportUploadIds = new Map<string, string>();
    withAbortManagement(uploadId, abortControllers, () =>
      startSSEPublish(
        {
          courseId: params.courseId,
          name: params.name,
          description: params.description,
          includeTodoLessons: params.includeTodoLessons,
        },
        {
          onStageChange: (stage) => {
            dispatch({ type: "UPDATE_PUBLISH_STAGE", uploadId, stage });
          },
          onExportVideos: (videos) => {
            for (const video of videos) {
              const exportUploadId = `${uploadId}-export-${video.id}`;
              exportUploadIds.set(video.id, exportUploadId);
              dispatch({
                type: "START_UPLOAD",
                uploadId: exportUploadId,
                videoId: video.id,
                title: video.title,
                uploadType: "export",
                isBatchEntry: true,
              });
            }
          },
          onExportStageChange: (videoId, stage) => {
            const exportUploadId = exportUploadIds.get(videoId);
            if (exportUploadId) {
              dispatch({
                type: "UPDATE_EXPORT_STAGE",
                uploadId: exportUploadId,
                stage,
              });
            }
          },
          onExportProgress: (videoId, stage, percent) => {
            if (stage === "queued") return;
            const exportUploadId = exportUploadIds.get(videoId);
            if (exportUploadId) {
              dispatch({
                type: "UPDATE_EXPORT_PROGRESS",
                uploadId: exportUploadId,
                stage,
                percent,
              });
            }
          },
          onExportComplete: (videoId) => {
            const exportUploadId = exportUploadIds.get(videoId);
            if (exportUploadId) {
              dispatch({ type: "UPLOAD_SUCCESS", uploadId: exportUploadId });
              exportUploadIds.delete(videoId);
            }
          },
          // Terminal per video: the publish already retried the export
          // server-side, and the publish itself is about to fail — never
          // auto-retry a standalone export from here.
          onExportError: (videoId, message) => {
            const exportUploadId = exportUploadIds.get(videoId);
            if (exportUploadId) {
              dispatch({
                type: "UPLOAD_FATAL_ERROR",
                uploadId: exportUploadId,
                errorMessage: message,
              });
              exportUploadIds.delete(videoId);
            }
          },
          onUploadProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onComplete: (result) => {
            dispatch({
              type: "PUBLISH_COMPLETE",
              uploadId,
              newDraftVersionId: result.newDraftVersionId,
            });
            dispatch({ type: "UPLOAD_SUCCESS", uploadId });
            abortControllers.delete(uploadId);
          },
          // A failed Commit auto-Discards the Pending Version server-side
          // (issue #1401), so there is no recoverable "pending" state to
          // retry from here — every failure is terminal for this attempt.
          onError: (message) => {
            // The per-video export entries this publish spawned would
            // otherwise dangle at their last stage forever: the stream that
            // fed them is gone, so fail the ones still in flight too.
            for (const [, exportUploadId] of exportUploadIds) {
              dispatch({
                type: "UPLOAD_FATAL_ERROR",
                uploadId: exportUploadId,
                errorMessage: message,
              });
            }
            exportUploadIds.clear();
            dispatch({
              type: "UPLOAD_FATAL_ERROR",
              uploadId,
              errorMessage: `${message}. Publish status may be unknown, so refresh before starting another publish.`,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: false,
};

const renderVerticalConfig: UploadTypeConfig<
  undefined,
  uploadReducer.RenderVerticalUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "render-vertical" as const,
    renderVerticalStage: "concatenating-clips" as const,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "render-vertical" as const,
    renderVerticalStage: "concatenating-clips" as const,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    renderVerticalStage: null,
  }),

  initiate: (uploadId, entry, _params, dispatch, abortControllers) => {
    withAbortManagement(uploadId, abortControllers, () =>
      startSSERenderVertical(
        { videoId: entry.videoId },
        {
          onStageChange: (stage) => {
            dispatch({
              type: "UPDATE_RENDER_VERTICAL_STAGE",
              uploadId,
              stage,
            });
          },
          onComplete: () => {
            dispatch({ type: "UPLOAD_SUCCESS", uploadId });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: false,
};

export const uploadTypeRegistry: Record<
  uploadReducer.UploadType,
  UploadTypeConfig<any, any>
> = {
  export: exportConfig,
  youtube: youtubeConfig,
  "youtube-shorts": youtubeShortsConfig,
  buffer: bufferConfig,
  "ai-hero": aiHeroConfig,
  "skills-changelog": skillsChangelogConfig,
  publish: publishConfig,
  "render-vertical": renderVerticalConfig,
};
