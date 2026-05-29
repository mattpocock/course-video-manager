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
): AbortController => {
  const abortController = new AbortController();

  performSSESocialPost(params, callbacks, abortController.signal).catch(
    (error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      callbacks.onError(
        error instanceof Error ? error.message : "Social post failed"
      );
    }
  );

  return abortController;
};

const performSSESocialPost = async (
  params: SSESocialParams,
  callbacks: SSESocialCallbacks,
  signal: AbortSignal
): Promise<void> => {
  const response = await fetch(`/api/videos/${params.videoId}/post-social`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption: params.caption }),
    signal,
  });

  if (!response.ok || !response.body) {
    callbacks.onError("Failed to start social post");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ") && eventType) {
        const eventData = JSON.parse(line.slice(6));
        if (eventType === "copying") {
          callbacks.onStageChange("copying");
          callbacks.onProgress(eventData.percentage);
        } else if (eventType === "syncing") {
          callbacks.onStageChange("syncing");
        } else if (eventType === "sending-webhook") {
          callbacks.onStageChange("sending-webhook");
        } else if (eventType === "complete") {
          callbacks.onComplete();
        } else if (eventType === "error") {
          callbacks.onError(eventData.message);
        }
        eventType = "";
      }
    }
  }
};
