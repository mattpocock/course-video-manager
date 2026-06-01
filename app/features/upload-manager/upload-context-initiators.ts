import type { Dispatch } from "react";
import { startSSEExport } from "./sse-export-client";

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
