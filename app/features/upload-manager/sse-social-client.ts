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
      copying: (data: { percentage: number }) => {
        callbacks.onStageChange("copying");
        callbacks.onProgress(data.percentage);
      },
      syncing: () => callbacks.onStageChange("syncing"),
      "sending-webhook": () => callbacks.onStageChange("sending-webhook"),
      complete: () => callbacks.onComplete(),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Social post failed",
  });
