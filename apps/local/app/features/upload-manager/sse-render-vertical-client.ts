import { consumeSSEStream } from "./consume-sse-stream";
import type { RenderVerticalStage } from "@/services/render-vertical-video-service";

export interface SSERenderVerticalParams {
  videoId: string;
}

export interface SSERenderVerticalCallbacks {
  onStageChange: (stage: RenderVerticalStage) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export const startSSERenderVertical = (
  params: SSERenderVerticalParams,
  callbacks: SSERenderVerticalCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/videos/${params.videoId}/render-vertical-sse`,
    body: {},
    events: {
      stage: (data: { stage: RenderVerticalStage }) =>
        callbacks.onStageChange(data.stage),
      complete: () => callbacks.onComplete(),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Vertical short render failed",
  });
