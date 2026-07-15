import { consumeSSEStream } from "./consume-sse-stream";
import type { uploadReducer } from "./upload-reducer";

export interface SSESocialParams {
  videoId: string;
  caption: string;
}

export interface SSESocialCallbacks {
  onProgress: (percentage: number) => void;
  onStageChange: (stage: uploadReducer.BufferStage) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export const startSSESocialPost = (
  params: SSESocialParams,
  callbacks: SSESocialCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/videos/${params.videoId}/post-social`,
    body: { caption: params.caption },
    events: {
      "uploading-blob": (data: { percentage: number }) => {
        callbacks.onStageChange("uploading-blob");
        callbacks.onProgress(data.percentage);
      },
      "creating-post": () => callbacks.onStageChange("creating-post"),
      polling: () => callbacks.onStageChange("polling"),
      "cleaning-up": () => callbacks.onStageChange("cleaning-up"),
      complete: () => callbacks.onComplete(),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Buffer posting failed",
  });
