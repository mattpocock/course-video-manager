import { consumeSSEStream } from "./consume-sse-stream";

export interface SSEAutofillParams {
  courseId: string;
  versionId: string;
  includeTodoLessons: boolean;
}

export interface SSEAutofillResult {
  filled: number;
  failed: number;
  skipped: number;
}

export interface SSEAutofillCallbacks {
  /** Every **Autofill Candidate**, announced before any work starts. */
  onVideos: (videos: Array<{ id: string; title: string }>) => void;
  onVideoComplete: (videoId: string) => void;
  onVideoError: (videoId: string, message: string) => void;
  onComplete: (result: SSEAutofillResult) => void;
  onError: (message: string) => void;
}

export const startSSEAutofill = (
  params: SSEAutofillParams,
  callbacks: SSEAutofillCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/courses/${params.courseId}/autofill-sse`,
    body: {
      versionId: params.versionId,
      includeTodoLessons: params.includeTodoLessons,
    },
    events: {
      "autofill-videos": (data: {
        videos: Array<{ id: string; title: string }>;
      }) => callbacks.onVideos(data.videos),
      "autofill-video-complete": (data: { videoId: string }) =>
        callbacks.onVideoComplete(data.videoId),
      "autofill-video-error": (data: { videoId: string; message: string }) =>
        callbacks.onVideoError(data.videoId, data.message),
      complete: (data: SSEAutofillResult) => callbacks.onComplete(data),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Autofill failed",
  });
