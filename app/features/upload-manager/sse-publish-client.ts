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
  // Per-video export progress during the "exporting" stage — the same
  // payloads the standalone batch export emits, on `export-*` wire names.
  onExportVideos: (videos: Array<{ id: string; title: string }>) => void;
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
  onExportComplete: (videoId: string) => void;
  onExportError: (videoId: string, message: string) => void;
  // Per-lesson Dropbox upload percentage during the "uploading" stage.
  onUploadProgress: (percentage: number) => void;
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
      "export-videos": (data: {
        videos: Array<{ id: string; title: string }>;
      }) => callbacks.onExportVideos(data.videos),
      "export-stage": (data: {
        videoId: string;
        stage: uploadReducer.ExportStage;
      }) => callbacks.onExportStageChange(data.videoId, data.stage),
      "export-progress": (data: {
        videoId: string;
        stage: uploadReducer.ExportStage;
        percent: number;
      }) => callbacks.onExportProgress(data.videoId, data.stage, data.percent),
      "export-complete": (data: { videoId: string }) =>
        callbacks.onExportComplete(data.videoId),
      "export-error": (data: { videoId: string; message: string }) =>
        callbacks.onExportError(data.videoId, data.message),
      "upload-progress": (data: { percentage: number }) =>
        callbacks.onUploadProgress(data.percentage),
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
