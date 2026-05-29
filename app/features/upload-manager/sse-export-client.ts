import { consumeSSEStream } from "./consume-sse-stream";
import type { uploadReducer } from "./upload-reducer";

export interface SSEExportParams {
  videoId: string;
}

export interface SSEExportCallbacks {
  onStageChange: (stage: uploadReducer.ExportStage) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export const startSSEExport = (
  params: SSEExportParams,
  callbacks: SSEExportCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/videos/${params.videoId}/export-sse`,
    body: {},
    events: {
      stage: (data: { stage: uploadReducer.ExportStage }) =>
        callbacks.onStageChange(data.stage),
      complete: () => callbacks.onComplete(),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Export failed",
  });
