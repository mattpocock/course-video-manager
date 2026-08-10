import type { uploadReducer } from "./upload-reducer";
import { startSSEAutofill } from "./sse-autofill-client";
import {
  withAbortManagement,
  type UploadTypeConfig,
} from "./upload-type-registry";

export interface AutofillParams {
  courseId: string;
  versionId: string;
  includeTodoLessons: boolean;
}

export const autofillConfig: UploadTypeConfig<
  AutofillParams,
  uploadReducer.AutofillUploadEntry
> = {
  createEntry: (base, action) => ({
    ...base,
    uploadType: "autofill" as const,
    // A child is born already writing; the parent still has to work out which
    // Videos it has work for.
    autofillStage: action.parentUploadId ? "writing" : "selecting",
    courseId: action.courseId ?? "",
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "autofill" as const,
    autofillStage: "selecting" as const,
    courseId: prev.courseId,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    autofillStage: null,
  }),

  initiate: (uploadId, _entry, params, dispatch, abortControllers) => {
    // Derived from the videoId rather than remembered in a map, so a settle
    // event addresses its row without a lookup table to keep in step.
    const videoUploadId = (videoId: string) => `${uploadId}-video-${videoId}`;
    const liveVideoIds = new Set<string>();
    const settle = (videoId: string, action: uploadReducer.Action) => {
      if (!liveVideoIds.delete(videoId)) return;
      dispatch(action);
    };

    withAbortManagement(uploadId, abortControllers, () =>
      startSSEAutofill(
        {
          courseId: params.courseId,
          versionId: params.versionId,
          includeTodoLessons: params.includeTodoLessons,
        },
        {
          onVideos: (videos) => {
            dispatch({
              type: "UPDATE_AUTOFILL_STAGE",
              uploadId,
              stage: "writing",
            });
            for (const video of videos) {
              liveVideoIds.add(video.id);
              dispatch({
                type: "START_UPLOAD",
                uploadId: videoUploadId(video.id),
                videoId: video.id,
                title: video.title,
                uploadType: "autofill",
                parentUploadId: uploadId,
              });
            }
          },
          onVideoComplete: (videoId) => {
            settle(videoId, {
              type: "UPLOAD_SUCCESS",
              uploadId: videoUploadId(videoId),
            });
          },
          // Terminal per Video: the run already gave this Video its one
          // attempt, so never auto-retry it from here.
          onVideoError: (videoId, message) => {
            settle(videoId, {
              type: "UPLOAD_FATAL_ERROR",
              uploadId: videoUploadId(videoId),
              errorMessage: message,
            });
          },
          onComplete: () => {
            dispatch({ type: "UPLOAD_SUCCESS", uploadId });
            abortControllers.delete(uploadId);
          },
          onError: (message) => {
            // The per-Video rows this run spawned would otherwise dangle at
            // their last stage forever: the stream that fed them is gone.
            for (const videoId of [...liveVideoIds]) {
              settle(videoId, {
                type: "UPLOAD_FATAL_ERROR",
                uploadId: videoUploadId(videoId),
                errorMessage: message,
              });
            }
            dispatch({
              type: "UPLOAD_FATAL_ERROR",
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
