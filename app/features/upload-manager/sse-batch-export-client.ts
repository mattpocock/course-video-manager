import { consumeSSEStream } from "./consume-sse-stream";
import type { uploadReducer } from "./upload-reducer";

export interface SSEBatchExportParams {
  versionId: string;
  includeTodoLessons: boolean;
}

export interface SSEBatchExportCallbacks {
  onVideos: (videos: Array<{ id: string; title: string }>) => void;
  onStageChange: (videoId: string, stage: uploadReducer.ExportStage) => void;
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
      complete: (data: { videoId: string }) =>
        callbacks.onComplete(data.videoId),
      error: (data: { videoId?: string | null; message: string }) =>
        callbacks.onError(data.videoId ?? null, data.message),
    },
    onError: (message) => callbacks.onError(null, message),
    errorLabel: "Batch export failed",
  });
