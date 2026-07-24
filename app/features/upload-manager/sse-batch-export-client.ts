import { consumeSSEStream } from "./consume-sse-stream";
import type { uploadReducer } from "./upload-reducer";

export interface SSEBatchExportParams {
  versionId: string;
  includeTodoLessons: boolean;
}

export interface SSEBatchExportCallbacks {
  onVideos: (videos: Array<{ id: string; title: string }>) => void;
  onStageChange: (videoId: string, stage: uploadReducer.ExportStage) => void;
  // Real ffmpeg progress within a stage: integer percent 0–99, resets when
  // the stage changes.
  onProgress: (
    videoId: string,
    stage: uploadReducer.ExportStage,
    percent: number
  ) => void;
  onComplete: (videoId: string) => void;
  onError: (videoId: string | null, message: string) => void;
}

export const startSSEBatchExport = (
  params: SSEBatchExportParams,
  callbacks: SSEBatchExportCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/courseVersions/${params.versionId}/batch-export-sse`,
    body: { includeTodoLessons: params.includeTodoLessons },
    events: {
      videos: (data: { videos: Array<{ id: string; title: string }> }) =>
        callbacks.onVideos(data.videos),
      stage: (data: { videoId: string; stage: uploadReducer.ExportStage }) =>
        callbacks.onStageChange(data.videoId, data.stage),
      "video-progress": (data: {
        videoId: string;
        stage: uploadReducer.ExportStage;
        percent: number;
      }) => callbacks.onProgress(data.videoId, data.stage, data.percent),
      complete: (data: { videoId: string }) =>
        callbacks.onComplete(data.videoId),
      error: (data: { videoId?: string | null; message: string }) =>
        callbacks.onError(data.videoId ?? null, data.message),
    },
    onError: (message) => callbacks.onError(null, message),
    errorLabel: "Batch export failed",
  });
