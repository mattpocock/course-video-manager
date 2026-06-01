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
import { createExportInitiator } from "./upload-context-initiators";
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
    caption: string
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
  startExportUpload: (videoId: string, title: string) => string;
  startBatchExportUpload: (versionId: string) => void;
  startDropboxPublish: (repoId: string, repoName: string) => string;
  startPublish: (
    courseId: string,
    courseName: string,
    name: string,
    description: string
  ) => string;
  dismissUpload: (uploadId: string) => void;
}

export const UploadContext = createContext<UploadContextType>(null!);

let nextUploadId = 0;
const generateUploadId = () => `upload-${++nextUploadId}`;

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

  const initiateSSEExportConnection = useCallback(
    createExportInitiator(dispatch, abortControllersRef.current),
    []
  );

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

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        dependsOn,
      });

      if (!dependsOn) {
        const config = uploadTypeRegistry["youtube"]!;
        const entry: uploadReducer.YouTubeUploadEntry = {
          uploadId,
          videoId,
          title,
          progress: 0,
          status: "uploading",
          uploadType: "youtube",
          youtubeVideoId: null,
          errorMessage: null,
          retryCount: 0,
          dependsOn: null,
        };
        config.initiate(
          uploadId,
          entry,
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
    (videoId: string, title: string, caption: string) => {
      const uploadId = generateUploadId();

      const params = { caption };
      paramsMapRef.current.set(uploadId, { type: "buffer", params });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "buffer",
      });

      const config = uploadTypeRegistry["buffer"]!;
      const entry: uploadReducer.BufferUploadEntry = {
        uploadId,
        videoId,
        title,
        progress: 0,
        status: "uploading",
        uploadType: "buffer",
        bufferStage: "copying",
        errorMessage: null,
        retryCount: 0,
        dependsOn: null,
      };
      config.initiate(
        uploadId,
        entry,
        params,
        dispatch,
        abortControllersRef.current
      );

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

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "ai-hero",
        dependsOn,
      });

      if (!dependsOn) {
        const config = uploadTypeRegistry["ai-hero"]!;
        const entry: uploadReducer.AiHeroUploadEntry = {
          uploadId,
          videoId,
          title,
          progress: 0,
          status: "uploading",
          uploadType: "ai-hero",
          aiHeroSlug: null,
          errorMessage: null,
          retryCount: 0,
          dependsOn: null,
        };
        config.initiate(
          uploadId,
          entry,
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

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "skills-changelog",
        dependsOn,
      });

      if (!dependsOn) {
        const config = uploadTypeRegistry["skills-changelog"]!;
        const entry: uploadReducer.SkillsChangelogUploadEntry = {
          uploadId,
          videoId,
          title,
          progress: 0,
          status: "uploading",
          uploadType: "skills-changelog",
          skillsChangelogSlug: null,
          errorMessage: null,
          retryCount: 0,
          dependsOn: null,
        };
        config.initiate(
          uploadId,
          entry,
          params,
          dispatch,
          abortControllersRef.current
        );
      }

      return uploadId;
    },
    []
  );

  const startExportUpload = useCallback(
    (videoId: string, title: string) => {
      const uploadId = generateUploadId();

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "export",
      });

      initiateSSEExportConnection(uploadId, videoId);

      return uploadId;
    },
    [initiateSSEExportConnection]
  );

  const startBatchExportUpload = useCallback((versionId: string) => {
    const abortController = startSSEBatchExport(
      { versionId },
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
  }, []);

  const startDropboxPublish = useCallback(
    (repoId: string, repoName: string) => {
      const uploadId = generateUploadId();

      const params = { repoId };
      paramsMapRef.current.set(uploadId, {
        type: "dropbox-publish",
        params,
      });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId: "",
        title: repoName,
        uploadType: "dropbox-publish",
      });

      const config = uploadTypeRegistry["dropbox-publish"]!;
      const entry: uploadReducer.DropboxPublishUploadEntry = {
        uploadId,
        videoId: "",
        title: repoName,
        progress: 0,
        status: "uploading",
        uploadType: "dropbox-publish",
        missingVideoCount: null,
        errorMessage: null,
        retryCount: 0,
        dependsOn: null,
      };
      config.initiate(
        uploadId,
        entry,
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
      description: string
    ) => {
      const uploadId = generateUploadId();

      const params = { courseId, name, description };
      paramsMapRef.current.set(uploadId, { type: "publish", params });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId: "",
        title: courseName,
        uploadType: "publish",
        courseId,
      });

      const config = uploadTypeRegistry["publish"]!;
      const entry: uploadReducer.PublishUploadEntry = {
        uploadId,
        videoId: "",
        title: courseName,
        progress: 0,
        status: "uploading",
        uploadType: "publish",
        publishStage: "validating",
        newDraftVersionId: null,
        courseId,
        errorMessage: null,
        retryCount: 0,
        dependsOn: null,
      };
      config.initiate(
        uploadId,
        entry,
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

        const retryConfig = uploadTypeRegistry[upload.uploadType];
        if (retryConfig) {
          const storedParams = paramsMapRef.current.get(uploadId);
          retryConfig.initiate(
            uploadId,
            upload,
            storedParams?.params,
            dispatch,
            abortControllersRef.current
          );
        }
      }

      // Handle waiting → uploading transition (dependency completed)
      if (prevUpload.status === "waiting" && upload.status === "uploading") {
        const depConfig = uploadTypeRegistry[upload.uploadType];
        if (depConfig) {
          const storedParams = paramsMapRef.current.get(uploadId);
          depConfig.initiate(
            uploadId,
            upload,
            storedParams?.params,
            dispatch,
            abortControllersRef.current
          );
        }
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
        startAiHeroUpload,
        startSkillsChangelogUpload,
        startExportUpload,
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
