import type { uploadReducer } from "./upload-reducer";

export interface SSEPublishParams {
  courseId: string;
  name: string;
  description: string;
}

export interface SSEPublishCallbacks {
  onStageChange: (stage: uploadReducer.PublishStage) => void;
  onComplete: (result: {
    publishedVersionId: string;
    newDraftVersionId: string;
  }) => void;
  onError: (message: string) => void;
}

export const startSSEPublish = (
  params: SSEPublishParams,
  callbacks: SSEPublishCallbacks
): AbortController => {
  const abortController = new AbortController();

  performSSEPublish(params, callbacks, abortController.signal).catch(
    (error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      callbacks.onError(
        error instanceof Error ? error.message : "Publish failed"
      );
    }
  );

  return abortController;
};

const performSSEPublish = async (
  params: SSEPublishParams,
  callbacks: SSEPublishCallbacks,
  signal: AbortSignal
): Promise<void> => {
  const response = await fetch(`/api/courses/${params.courseId}/publish-sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      description: params.description,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    callbacks.onError("Failed to start publish");
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
        if (eventType === "progress") {
          callbacks.onStageChange(eventData.stage);
        } else if (eventType === "complete") {
          callbacks.onComplete({
            publishedVersionId: eventData.publishedVersionId,
            newDraftVersionId: eventData.newDraftVersionId,
          });
        } else if (eventType === "error") {
          callbacks.onError(eventData.message);
        }
        eventType = "";
      }
    }
  }
};
