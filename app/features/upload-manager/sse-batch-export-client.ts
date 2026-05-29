import type { uploadReducer } from "./upload-reducer";

export interface SSEBatchExportParams {
  versionId: string;
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
): AbortController => {
  const abortController = new AbortController();

  performSSEBatchExport(params, callbacks, abortController.signal).catch(
    (error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      callbacks.onError(
        null,
        error instanceof Error ? error.message : "Batch export failed"
      );
    }
  );

  return abortController;
};

const performSSEBatchExport = async (
  params: SSEBatchExportParams,
  callbacks: SSEBatchExportCallbacks,
  signal: AbortSignal
): Promise<void> => {
  const response = await fetch(
    `/api/courseVersions/${params.versionId}/batch-export-sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal,
    }
  );

  if (!response.ok || !response.body) {
    callbacks.onError(null, "Failed to start batch export");
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
        if (eventType === "videos") {
          callbacks.onVideos(eventData.videos);
        } else if (eventType === "stage") {
          callbacks.onStageChange(eventData.videoId, eventData.stage);
        } else if (eventType === "complete") {
          callbacks.onComplete(eventData.videoId);
        } else if (eventType === "error") {
          callbacks.onError(eventData.videoId ?? null, eventData.message);
        }
        eventType = "";
      }
    }
  }
};
