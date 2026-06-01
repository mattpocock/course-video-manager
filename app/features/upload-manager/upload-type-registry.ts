import type { uploadReducer } from "./upload-reducer";
import { startSSEExport } from "./sse-export-client";

type StartUploadAction = Extract<
  uploadReducer.Action,
  { type: "START_UPLOAD" }
>;
type UploadSuccessAction = Extract<
  uploadReducer.Action,
  { type: "UPLOAD_SUCCESS" }
>;

export interface UploadTypeConfig<
  TParams = unknown,
  TEntry extends uploadReducer.UploadEntry = uploadReducer.UploadEntry,
> {
  createEntry: (
    base: uploadReducer.BaseUploadEntry,
    action: StartUploadAction
  ) => TEntry;

  resetEntry: (
    base: uploadReducer.BaseUploadEntry,
    prevEntry: TEntry
  ) => TEntry;

  applySuccess: (entry: TEntry, action: UploadSuccessAction) => TEntry;

  initiate: (
    uploadId: string,
    entry: TEntry,
    params: TParams,
    dispatch: (action: uploadReducer.Action) => void,
    abortControllers: Map<string, AbortController>
  ) => void;

  supportsDependsOn?: boolean;
}

export function withAbortManagement(
  uploadId: string,
  abortControllers: Map<string, AbortController>,
  start: () => AbortController
): void {
  const existing = abortControllers.get(uploadId);
  if (existing) existing.abort();
  const controller = start();
  abortControllers.set(uploadId, controller);
}

const exportConfig: UploadTypeConfig<
  undefined,
  uploadReducer.ExportUploadEntry
> = {
  createEntry: (base, action) => ({
    ...base,
    uploadType: "export" as const,
    exportStage: "queued" as const,
    isBatchEntry: action.isBatchEntry ?? false,
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "export" as const,
    exportStage: "queued" as const,
    isBatchEntry: prev.isBatchEntry,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    exportStage: null,
  }),

  initiate: (uploadId, entry, _params, dispatch, abortControllers) => {
    withAbortManagement(uploadId, abortControllers, () =>
      startSSEExport(
        { videoId: entry.videoId },
        {
          onStageChange: (stage) => {
            dispatch({ type: "UPDATE_EXPORT_STAGE", uploadId, stage });
          },
          onComplete: () => {
            dispatch({ type: "UPLOAD_SUCCESS", uploadId });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllers.delete(uploadId);
          },
        }
      )
    );
  },

  supportsDependsOn: false,
};

export const uploadTypeRegistry: Partial<
  Record<uploadReducer.UploadType, UploadTypeConfig<any, any>>
> = {
  export: exportConfig,
};
