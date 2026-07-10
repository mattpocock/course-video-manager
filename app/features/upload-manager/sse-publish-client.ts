import { consumeSSEStream } from "./consume-sse-stream";
import type { uploadReducer } from "./upload-reducer";

export interface SSEPublishParams {
  courseId: string;
  name: string;
  description: string;
  includeTodoLessons: boolean;
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
): AbortController =>
  consumeSSEStream({
    url: `/api/courses/${params.courseId}/publish-sse`,
    body: {
      name: params.name,
      description: params.description,
      includeTodoLessons: params.includeTodoLessons,
    },
    events: {
      progress: (data: { stage: uploadReducer.PublishStage }) =>
        callbacks.onStageChange(data.stage),
      complete: (data: {
        publishedVersionId: string;
        newDraftVersionId: string;
      }) =>
        callbacks.onComplete({
          publishedVersionId: data.publishedVersionId,
          newDraftVersionId: data.newDraftVersionId,
        }),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Publish failed",
  });
