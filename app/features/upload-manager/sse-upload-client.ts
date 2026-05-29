export interface SSEUploadParams {
  videoId: string;
  title: string;
  description: string;
  privacyStatus: "public" | "unlisted";
  thumbnailId: string;
}

export interface SSEUploadCallbacks {
  onProgress: (percentage: number) => void;
  onComplete: (youtubeVideoId: string) => void;
  onError: (message: string) => void;
}

export const startSSEUpload = (
  params: SSEUploadParams,
  callbacks: SSEUploadCallbacks
): AbortController => {
  const abortController = new AbortController();

  performSSEUpload(params, callbacks, abortController.signal).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    callbacks.onError(error instanceof Error ? error.message : "Upload failed");
  });

  return abortController;
};

const performSSEUpload = async (
  params: SSEUploadParams,
  callbacks: SSEUploadCallbacks,
  signal: AbortSignal
): Promise<void> => {
  const response = await fetch(`/api/videos/${params.videoId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: params.title,
      description: params.description,
      privacyStatus: params.privacyStatus,
      thumbnailId: params.thumbnailId,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    callbacks.onError("Failed to start upload");
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
          callbacks.onComplete(eventData.videoId);
        } else if (eventType === "error") {
          callbacks.onError(eventData.message);
        }
        eventType = "";
      }
    }
  }
};
