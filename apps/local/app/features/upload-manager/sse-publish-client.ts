import { consumeSSEStream } from "./consume-sse-stream";
import type { uploadReducer } from "./upload-reducer";

export interface SSEPublishParams {
  courseId: string;
  name: string;
  description: string;
  includeTodoLessons: boolean;
}

export interface SSEPublishCallbacks {
  onStageChange: (stage: uploadReducer.PublishStage) => void;
  // Per-Video encoding progress, on `export-*` wire names — the same payloads
  // the standalone batch export emits. The roster and the per-Video completion
  // are NOT taken from here: a Publish's tasks span encoding AND uploading, so
  // both come off the `publish-*`/`video-upload-*` events below, which cover
  // every shipping Video rather than only the ones that still need encoding.
  onExportStageChange: (
    videoId: string,
    stage: uploadReducer.ExportStage
  ) => void;
  // Real ffmpeg progress within an export stage: integer percent 0–99,
  // resets when the stage changes.
  onExportProgress: (
    videoId: string,
    stage: uploadReducer.ExportStage,
    percent: number
  ) => void;
  onExportError: (videoId: string, message: string) => void;
  // Every Video this Publish ships, exported or not — one task each.
  onPublishVideos: (videos: Array<{ id: string; title: string }>) => void;
  // This Video's bytes are ready and it is waiting for a slot in the upload
  // pool.
  onVideoUploadQueued: (videoId: string) => void;
  onVideoUploadProgress: (
    videoId: string,
    uploadedBytes: number,
    totalBytes: number
  ) => void;
  onVideoUploadComplete: (videoId: string) => void;
  onVideoUploadError: (videoId: string, message: string) => void;
  onComplete: (result: {
    publishedVersionId: string;
    newDraftVersionId: string;
  }) => void;
  onError: (message: string) => void;
}

export const startSSEPublish = (
  params: SSEPublishParams,
  callbacks: SSEPublishCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/courses/${params.courseId}/publish-sse`,
    body: {
      name: params.name,
      description: params.description,
      includeTodoLessons: params.includeTodoLessons,
    },
    events: {
      progress: (data: { stage: uploadReducer.PublishStage }) =>
        callbacks.onStageChange(data.stage),
      "export-stage": (data: {
        videoId: string;
        stage: uploadReducer.ExportStage;
      }) => callbacks.onExportStageChange(data.videoId, data.stage),
      "export-progress": (data: {
        videoId: string;
        stage: uploadReducer.ExportStage;
        percent: number;
      }) => callbacks.onExportProgress(data.videoId, data.stage, data.percent),
      "export-error": (data: { videoId: string; message: string }) =>
        callbacks.onExportError(data.videoId, data.message),
      "publish-videos": (data: {
        videos: Array<{ id: string; title: string }>;
      }) => callbacks.onPublishVideos(data.videos),
      "video-upload-queued": (data: { videoId: string }) =>
        callbacks.onVideoUploadQueued(data.videoId),
      "video-upload-progress": (data: {
        videoId: string;
        uploadedBytes: number;
        totalBytes: number;
      }) =>
        callbacks.onVideoUploadProgress(
          data.videoId,
          data.uploadedBytes,
          data.totalBytes
        ),
      "video-upload-complete": (data: { videoId: string }) =>
        callbacks.onVideoUploadComplete(data.videoId),
      "video-upload-error": (data: { videoId: string; message: string }) =>
        callbacks.onVideoUploadError(data.videoId, data.message),
      complete: (data: {
        publishedVersionId: string;
        newDraftVersionId: string;
      }) =>
        callbacks.onComplete({
          publishedVersionId: data.publishedVersionId,
          newDraftVersionId: data.newDraftVersionId,
        }),
      // A failed Commit auto-Discards the Pending Version server-side (issue
      // #1401), so every publish failure arrives as a plain, terminal error.
      error: (data: { message: string } & Record<string, unknown>) => {
        callbacks.onError(data.message);
      },
    },
    onError: callbacks.onError,
    errorLabel: "Publish failed",
  });
