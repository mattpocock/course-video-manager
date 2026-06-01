import type { Dispatch } from "react";
import { startSSEExport } from "./sse-export-client";
import { startSSEDropboxPublish } from "./sse-dropbox-publish-client";
import { startSSEPublish } from "./sse-publish-client";

type AnyDispatch = Dispatch<any>;

export function createExportInitiator(
  dispatch: AnyDispatch,
  abortControllers: Map<string, AbortController>
) {
  return (uploadId: string, videoId: string) => {
    const existing = abortControllers.get(uploadId);
    if (existing) existing.abort();

    const abortController = startSSEExport(
      { videoId },
      {
        onStageChange: (stage) => {
          dispatch({ type: "UPDATE_EXPORT_STAGE", uploadId, stage });
        },
        onComplete: () => {
          dispatch({ type: "UPLOAD_SUCCESS", uploadId });
          abortControllers.delete(uploadId);
        },
        onError: (message) => {
          dispatch({ type: "UPLOAD_ERROR", uploadId, errorMessage: message });
          abortControllers.delete(uploadId);
        },
      }
    );

    abortControllers.set(uploadId, abortController);
  };
}

export function createDropboxPublishInitiator(
  dispatch: AnyDispatch,
  abortControllers: Map<string, AbortController>
) {
  return (uploadId: string, repoId: string) => {
    const existing = abortControllers.get(uploadId);
    if (existing) existing.abort();

    const abortController = startSSEDropboxPublish(
      { repoId },
      {
        onProgress: (percentage) => {
          dispatch({ type: "UPDATE_PROGRESS", uploadId, progress: percentage });
        },
        onComplete: (missingVideoCount) => {
          if (missingVideoCount > 0) {
            dispatch({
              type: "UPDATE_DROPBOX_PUBLISH_MISSING_COUNT",
              uploadId,
              missingVideoCount,
            });
          }
          dispatch({ type: "UPLOAD_SUCCESS", uploadId });
          abortControllers.delete(uploadId);
        },
        onError: (message) => {
          dispatch({ type: "UPLOAD_ERROR", uploadId, errorMessage: message });
          abortControllers.delete(uploadId);
        },
      }
    );

    abortControllers.set(uploadId, abortController);
  };
}

export function createPublishInitiator(
  dispatch: AnyDispatch,
  abortControllers: Map<string, AbortController>
) {
  return (
    uploadId: string,
    courseId: string,
    name: string,
    description: string
  ) => {
    const existing = abortControllers.get(uploadId);
    if (existing) existing.abort();

    const abortController = startSSEPublish(
      { courseId, name, description },
      {
        onStageChange: (stage) => {
          dispatch({ type: "UPDATE_PUBLISH_STAGE", uploadId, stage });
        },
        onComplete: (result) => {
          dispatch({
            type: "PUBLISH_COMPLETE",
            uploadId,
            newDraftVersionId: result.newDraftVersionId,
          });
          dispatch({ type: "UPLOAD_SUCCESS", uploadId });
          abortControllers.delete(uploadId);
        },
        onError: (message) => {
          dispatch({ type: "UPLOAD_ERROR", uploadId, errorMessage: message });
          abortControllers.delete(uploadId);
        },
      }
    );

    abortControllers.set(uploadId, abortController);
  };
}
