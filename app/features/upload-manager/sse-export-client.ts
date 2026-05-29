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
): AbortController => {
  const abortController = new AbortController();

  performSSEExport(params, callbacks, abortController.signal).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    callbacks.onError(error instanceof Error ? error.message : "Export failed");
  });

  return abortController;
};

const performSSEExport = async (
  params: SSEExportParams,
  callbacks: SSEExportCallbacks,
  signal: AbortSignal
): Promise<void> => {
  const response = await fetch(`/api/videos/${params.videoId}/export-sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal,
  });

  if (!response.ok || !response.body) {
    callbacks.onError("Failed to start export");
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
        if (eventType === "stage") {
          callbacks.onStageChange(eventData.stage);
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
