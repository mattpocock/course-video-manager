import {
  createContext,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";
import { showSuccessToast, showErrorToast } from "./upload-toasts";
import { startSSEBatchExport } from "./sse-batch-export-client";
import { uploadTypeRegistry } from "./upload-type-registry";

export interface UploadContextType {
  uploads: uploadReducer.State["uploads"];
  startUpload: (
    videoId: string,
    title: string,
    description: string,
    privacyStatus: "public" | "unlisted",
    thumbnailId: string,
    dependsOn?: string
  ) => string;
  startSocialUpload: (
    videoId: string,
    title: string,
    caption: string,
    dependsOn?: string
  ) => string;
  startAiHeroUpload: (
    videoId: string,
    title: string,
    body: string,
    description: string,
    slug: string,
    dependsOn?: string
  ) => string;
  startSkillsChangelogUpload: (
    videoId: string,
    title: string,
    slug: string,
    body: string,
    description: string,
    newsletterSubject: string,
    newsletterPreviewText: string,
    newsletterCopy: string,
    dependsOn?: string
  ) => string;
  startYoutubeShortsUpload: (
    videoId: string,
    title: string,
    description: string,
    dependsOn?: string
  ) => string;
  startExportUpload: (videoId: string, title: string) => string;
  startRenderVerticalUpload: (videoId: string, title: string) => string;
  startBatchExportUpload: (
    versionId: string,
    includeTodoLessons: boolean
  ) => void;
  startDropboxPublish: (repoId: string, repoName: string) => string;
  startPublish: (
    courseId: string,
    courseName: string,
    name: string,
    description: string,
    includeTodoLessons: boolean
  ) => string;
  dismissUpload: (uploadId: string) => void;
}

export const UploadContext = createContext<UploadContextType>(null!);

let nextUploadId = 0;
const generateUploadId = () => `upload-${++nextUploadId}`;

function initiateFromRegistry(
  uploadType: uploadReducer.UploadType,
  action: Extract<uploadReducer.Action, { type: "START_UPLOAD" }>,
  params: unknown,
  dispatch: (action: uploadReducer.Action) => void,
  abortControllers: Map<string, AbortController>
) {
  const config = uploadTypeRegistry[uploadType];
  const base: uploadReducer.BaseUploadEntry = {
    uploadId: action.uploadId,
    videoId: action.videoId,
    title: action.title,
    progress: 0,
    status: "uploading",
    errorMessage: null,
    retryCount: 0,
    terminal: false,
    dependsOn: null,
  };
  const entry = config.createEntry(base, action);
  config.initiate(action.uploadId, entry, params, dispatch, abortControllers);
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(
    uploadReducer,
    undefined,
    createInitialUploadState
  );

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const previousUploadsRef = useRef<uploadReducer.State["uploads"]>({});

  const paramsMapRef = useRef<
    Map<string, { type: uploadReducer.UploadType; params: unknown }>
  >(new Map());

  // Maps videoId → uploadId for batch exports
  const batchVideoIdToUploadIdRef = useRef<Map<string, string>>(new Map());

  const startUpload = useCallback(
    (
      videoId: string,
      title: string,
      description: string,
      privacyStatus: "public" | "unlisted",
      thumbnailId: string,
      dependsOn?: string
    ) => {
      const uploadId = generateUploadId();

      const params = { description, privacyStatus, thumbnailId };
      paramsMapRef.current.set(uploadId, { type: "youtube", params });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId,
        title,
        dependsOn,
      };
      dispatch(action);

      if (!dependsOn) {
        initiateFromRegistry(
          "youtube",
          action,
          params,
          dispatch,
          abortControllersRef.current
        );
      }

      return uploadId;
    },
    []
  );

  const startSocialUpload = useCallback(
    (videoId: string, title: string, caption: string, dependsOn?: string) => {
      const uploadId = generateUploadId();

      const params = { caption };
      paramsMapRef.current.set(uploadId, { type: "buffer", params });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId,
        title,
        uploadType: "buffer" as const,
        dependsOn,
      };
      dispatch(action);

      if (!dependsOn) {
        initiateFromRegistry(
          "buffer",
          action,
          params,
          dispatch,
          abortControllersRef.current
        );
      }

      return uploadId;
    },
    []
  );

  const startYoutubeShortsUpload = useCallback(
    (
      videoId: string,
      title: string,
      description: string,
      dependsOn?: string
    ) => {
      const uploadId = generateUploadId();

      const params = { description };
      paramsMapRef.current.set(uploadId, {
        type: "youtube-shorts",
        params,
      });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId,
        title,
        uploadType: "youtube-shorts" as const,
        dependsOn,
      };
      dispatch(action);

      if (!dependsOn) {
        initiateFromRegistry(
          "youtube-shorts",
          action,
          params,
          dispatch,
          abortControllersRef.current
        );
      }

      return uploadId;
    },
    []
  );

  const startAiHeroUpload = useCallback(
    (
      videoId: string,
      title: string,
      body: string,
      description: string,
      slug: string,
      dependsOn?: string
    ) => {
      const uploadId = generateUploadId();

      const params = { body, description, slug };
      paramsMapRef.current.set(uploadId, { type: "ai-hero", params });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId,
        title,
        uploadType: "ai-hero" as const,
        dependsOn,
      };
      dispatch(action);

      if (!dependsOn) {
        initiateFromRegistry(
          "ai-hero",
          action,
          params,
          dispatch,
          abortControllersRef.current
        );
      }

      return uploadId;
    },
    []
  );

  const startSkillsChangelogUpload = useCallback(
    (
      videoId: string,
      title: string,
      slug: string,
      body: string,
      description: string,
      newsletterSubject: string,
      newsletterPreviewText: string,
      newsletterCopy: string,
      dependsOn?: string
    ) => {
      const uploadId = generateUploadId();

      const params = {
        slug,
        body,
        description,
        newsletterSubject,
        newsletterPreviewText,
        newsletterCopy,
      };
      paramsMapRef.current.set(uploadId, {
        type: "skills-changelog",
        params,
      });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId,
        title,
        uploadType: "skills-changelog" as const,
        dependsOn,
      };
      dispatch(action);

      if (!dependsOn) {
        initiateFromRegistry(
          "skills-changelog",
          action,
          params,
          dispatch,
          abortControllersRef.current
        );
      }

      return uploadId;
    },
    []
  );

  const startExportUpload = useCallback((videoId: string, title: string) => {
    const uploadId = generateUploadId();

    const action = {
      type: "START_UPLOAD" as const,
      uploadId,
      videoId,
      title,
      uploadType: "export" as const,
    };
    dispatch(action);

    initiateFromRegistry(
      "export",
      action,
      undefined,
      dispatch,
      abortControllersRef.current
    );

    return uploadId;
  }, []);

  const startRenderVerticalUpload = useCallback(
    (videoId: string, title: string) => {
      const uploadId = generateUploadId();

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId,
        title,
        uploadType: "render-vertical" as const,
      };
      dispatch(action);

      initiateFromRegistry(
        "render-vertical",
        action,
        undefined,
        dispatch,
        abortControllersRef.current
      );

      return uploadId;
    },
    []
  );

  const startBatchExportUpload = useCallback(
    (versionId: string, includeTodoLessons: boolean) => {
      const abortController = startSSEBatchExport(
        { versionId, includeTodoLessons },
        {
          onVideos: (videos) => {
            for (const video of videos) {
              const uploadId = generateUploadId();
              batchVideoIdToUploadIdRef.current.set(video.id, uploadId);
              dispatch({
                type: "START_UPLOAD",
                uploadId,
                videoId: video.id,
                title: video.title,
                uploadType: "export",
                isBatchEntry: true,
              });
            }
          },
          onStageChange: (videoId, stage) => {
            const uploadId = batchVideoIdToUploadIdRef.current.get(videoId);
            if (uploadId) {
              dispatch({
                type: "UPDATE_EXPORT_STAGE",
                uploadId,
                stage,
              });
            }
          },
          onComplete: (videoId) => {
            const uploadId = batchVideoIdToUploadIdRef.current.get(videoId);
            if (uploadId) {
              dispatch({
                type: "UPLOAD_SUCCESS",
                uploadId,
              });
              batchVideoIdToUploadIdRef.current.delete(videoId);
            }
          },
          onError: (videoId, message) => {
            if (videoId === null) {
              // Connection-level error — mark all remaining batch entries as errored
              for (const [, uid] of batchVideoIdToUploadIdRef.current) {
                dispatch({
                  type: "UPLOAD_ERROR",
                  uploadId: uid,
                  errorMessage: message,
                });
              }
              batchVideoIdToUploadIdRef.current.clear();
            } else {
              const uploadId = batchVideoIdToUploadIdRef.current.get(videoId);
              if (uploadId) {
                dispatch({
                  type: "UPLOAD_ERROR",
                  uploadId,
                  errorMessage: message,
                });
                batchVideoIdToUploadIdRef.current.delete(videoId);
              }
            }
          },
        }
      );

      // Store with a synthetic key so it can be cleaned up on unmount
      abortControllersRef.current.set(`batch-${versionId}`, abortController);
    },
    []
  );

  const startDropboxPublish = useCallback(
    (repoId: string, repoName: string) => {
      const uploadId = generateUploadId();

      const params = { repoId };
      paramsMapRef.current.set(uploadId, {
        type: "dropbox-publish",
        params,
      });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId: "",
        title: repoName,
        uploadType: "dropbox-publish" as const,
      };
      dispatch(action);

      initiateFromRegistry(
        "dropbox-publish",
        action,
        params,
        dispatch,
        abortControllersRef.current
      );

      return uploadId;
    },
    []
  );

  const startPublish = useCallback(
    (
      courseId: string,
      courseName: string,
      name: string,
      description: string,
      includeTodoLessons: boolean
    ) => {
      const uploadId = generateUploadId();

      const params = { courseId, name, description, includeTodoLessons };
      paramsMapRef.current.set(uploadId, { type: "publish", params });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId: "",
        title: courseName,
        uploadType: "publish" as const,
        courseId,
      };
      dispatch(action);

      initiateFromRegistry(
        "publish",
        action,
        params,
        dispatch,
        abortControllersRef.current
      );

      return uploadId;
    },
    []
  );

  const dismissUpload = useCallback((uploadId: string) => {
    const abortController = abortControllersRef.current.get(uploadId);
    if (abortController) {
      abortController.abort();
      abortControllersRef.current.delete(uploadId);
    }
    paramsMapRef.current.delete(uploadId);
    dispatch({ type: "DISMISS", uploadId });
  }, []);

  // Single effect: watch for status transitions to fire toasts and handle auto-retry
  useEffect(() => {
    const prev = previousUploadsRef.current;
    const current = state.uploads;

    for (const [uploadId, upload] of Object.entries(current)) {
      const prevUpload = prev[uploadId];
      if (!prevUpload) continue;
      if (prevUpload.status === upload.status) continue;

      if (upload.status === "success") {
        showSuccessToast(upload);
      }

      if (upload.status === "error") {
        showErrorToast(upload);
      }

      if (upload.status === "retrying") {
        dispatch({ type: "RETRY", uploadId });

        const storedParams = paramsMapRef.current.get(uploadId);
        uploadTypeRegistry[upload.uploadType].initiate(
          uploadId,
          upload,
          storedParams?.params,
          dispatch,
          abortControllersRef.current
        );
      }

      // Handle waiting → uploading transition (dependency completed)
      if (prevUpload.status === "waiting" && upload.status === "uploading") {
        const storedParams = paramsMapRef.current.get(uploadId);
        uploadTypeRegistry[upload.uploadType].initiate(
          uploadId,
          upload,
          storedParams?.params,
          dispatch,
          abortControllersRef.current
        );
      }
    }

    previousUploadsRef.current = current;
  }, [state.uploads]);

  // Clean up abort controllers on unmount
  useEffect(() => {
    return () => {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
    };
  }, []);

  return (
    <UploadContext.Provider
      value={{
        uploads: state.uploads,
        startUpload,
        startSocialUpload,
        startYoutubeShortsUpload,
        startAiHeroUpload,
        startSkillsChangelogUpload,
        startExportUpload,
        startRenderVerticalUpload,
        startBatchExportUpload,
        startDropboxPublish,
        startPublish,
        dismissUpload,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}
