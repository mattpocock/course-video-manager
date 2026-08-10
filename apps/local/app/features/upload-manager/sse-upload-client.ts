import { consumeSSEStream } from "./consume-sse-stream";

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
): AbortController =>
  consumeSSEStream({
    url: `/api/videos/${params.videoId}/upload`,
    body: {
      title: params.title,
      description: params.description,
      privacyStatus: params.privacyStatus,
      thumbnailId: params.thumbnailId,
    },
    events: {
      progress: (data: { percentage: number }) =>
        callbacks.onProgress(data.percentage),
      complete: (data: { videoId: string }) =>
        callbacks.onComplete(data.videoId),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Upload failed",
  });
