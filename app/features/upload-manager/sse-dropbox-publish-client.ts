import { consumeSSEStream } from "./consume-sse-stream";

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
): AbortController =>
  consumeSSEStream({
    url: "/api/courses/publish-to-dropbox-sse",
    body: { repoId: params.repoId },
    events: {
      progress: (data: { percentage: number }) =>
        callbacks.onProgress(data.percentage),
      complete: (data: { missingVideoCount: number }) =>
        callbacks.onComplete(data.missingVideoCount),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Publish failed",
  });
