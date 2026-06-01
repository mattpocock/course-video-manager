import type { uploadReducer } from "./upload-reducer";
import { startSSEAiHeroPost } from "./sse-ai-hero-client";
import { startSSEExport } from "./sse-export-client";
import { startSSESkillsChangelogPost } from "./sse-skills-changelog-client";
import { startSSESocialPost } from "./sse-social-client";
import { startSSEUpload } from "./sse-upload-client";

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
    bufferStage: "copying" as const,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "buffer" as const,
    bufferStage: "copying" as const,
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

  supportsDependsOn: false,
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

export const uploadTypeRegistry: Partial<
  Record<uploadReducer.UploadType, UploadTypeConfig<any, any>>
> = {
  export: exportConfig,
  youtube: youtubeConfig,
  buffer: bufferConfig,
  "ai-hero": aiHeroConfig,
  "skills-changelog": skillsChangelogConfig,
};
