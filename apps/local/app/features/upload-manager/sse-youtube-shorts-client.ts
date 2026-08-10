import { consumeSSEStream } from "./consume-sse-stream";

export interface SSEYoutubeShortsParams {
  videoId: string;
  title: string;
  description: string;
}

export interface SSEYoutubeShortsCallbacks {
  onProgress: (percentage: number) => void;
  onComplete: (youtubeVideoId: string) => void;
  onError: (message: string) => void;
}

export const startSSEYoutubeShortsPost = (
  params: SSEYoutubeShortsParams,
  callbacks: SSEYoutubeShortsCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/videos/${params.videoId}/post-youtube-shorts`,
    body: {
      title: params.title,
      description: params.description,
    },
    events: {
      progress: (data: { percentage: number }) =>
        callbacks.onProgress(data.percentage),
      complete: (data: { youtubeVideoId: string }) =>
        callbacks.onComplete(data.youtubeVideoId),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "YouTube Shorts posting failed",
  });
