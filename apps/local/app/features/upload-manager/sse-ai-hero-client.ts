import { consumeSSEStream } from "./consume-sse-stream";

export interface SSEAiHeroParams {
  videoId: string;
  title: string;
  body: string;
  description: string;
  slug: string;
}

export interface SSEAiHeroCallbacks {
  onProgress: (percentage: number) => void;
  onComplete: (slug: string) => void;
  onError: (message: string) => void;
}

export const startSSEAiHeroPost = (
  params: SSEAiHeroParams,
  callbacks: SSEAiHeroCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/videos/${params.videoId}/post-ai-hero`,
    body: {
      title: params.title,
      body: params.body,
      description: params.description,
      slug: params.slug,
    },
    events: {
      progress: (data: { percentage: number }) =>
        callbacks.onProgress(data.percentage),
      complete: (data: { slug: string }) => callbacks.onComplete(data.slug),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "AI Hero post failed",
  });
