export interface SSEDropboxPublishParams {
  repoId: string;
}

export interface SSEDropboxPublishCallbacks {
  onProgress: (percentage: number) => void;
  onComplete: (missingVideoCount: number) => void;
  onError: (message: string) => void;
}

export const startSSEDropboxPublish = (
  params: SSEDropboxPublishParams,
  callbacks: SSEDropboxPublishCallbacks
): AbortController => {
  const abortController = new AbortController();

  performSSEDropboxPublish(params, callbacks, abortController.signal).catch(
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

const performSSEDropboxPublish = async (
  params: SSEDropboxPublishParams,
  callbacks: SSEDropboxPublishCallbacks,
  signal: AbortSignal
): Promise<void> => {
  const response = await fetch("/api/courses/publish-to-dropbox-sse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId: params.repoId }),
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
          callbacks.onProgress(eventData.percentage);
        } else if (eventType === "complete") {
          callbacks.onComplete(eventData.missingVideoCount);
        } else if (eventType === "error") {
          callbacks.onError(eventData.message);
        }
        eventType = "";
      }
    }
  }
};
