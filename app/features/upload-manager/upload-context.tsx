import {
  createContext,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";
import { showSuccessToast, showErrorToast } from "./upload-toasts";
import { startSSEUpload } from "./sse-upload-client";
import { startSSEBatchExport } from "./sse-batch-export-client";
import {
  createAiHeroInitiator,
  createDropboxPublishInitiator,
  createExportInitiator,
  createPublishInitiator,
  createSkillsChangelogInitiator,
  createSocialInitiator,
} from "./upload-context-initiators";
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

  // Stores description + privacyStatus + thumbnailId for YouTube retries
  const uploadParamsRef = useRef<
    Map<
      string,
      {
        description: string;
        privacyStatus: "public" | "unlisted";
        thumbnailId: string;
      }
    >
  >(new Map());

  // Stores caption for Buffer retries
  const socialParamsRef = useRef<Map<string, { caption: string }>>(new Map());

  // Stores body + description + slug for AI Hero retries
  const aiHeroParamsRef = useRef<
    Map<string, { body: string; description: string; slug: string }>
  >(new Map());

  // Stores all skills-changelog fields for retries
  const skillsChangelogParamsRef = useRef<
    Map<
      string,
      {
        slug: string;
        body: string;
        description: string;
        newsletterSubject: string;
        newsletterPreviewText: string;
        newsletterCopy: string;
      }
    >
  >(new Map());

  // Maps videoId → uploadId for batch exports
  const batchVideoIdToUploadIdRef = useRef<Map<string, string>>(new Map());

  const initiateSSEConnection = useCallback(
    (
      uploadId: string,
      videoId: string,
      title: string,
      description: string,
      privacyStatus: "public" | "unlisted",
      thumbnailId: string
    ) => {
      const existing = abortControllersRef.current.get(uploadId);
      if (existing) {
        existing.abort();
      }

      const abortController = startSSEUpload(
        { videoId, title, description, privacyStatus, thumbnailId },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onComplete: (youtubeVideoId) => {
            dispatch({
              type: "UPLOAD_SUCCESS",
              uploadId,
              youtubeVideoId,
            });
            abortControllersRef.current.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllersRef.current.delete(uploadId);
          },
        }
      );

      abortControllersRef.current.set(uploadId, abortController);
    },
    []
  );

  const initiateSSESocialConnection = useCallback(
    createSocialInitiator(dispatch, abortControllersRef.current),
    []
  );

  const initiateSSEAiHeroConnection = useCallback(
    createAiHeroInitiator(dispatch, abortControllersRef.current),
    []
  );

  const initiateSSESkillsChangelogConnection = useCallback(
    createSkillsChangelogInitiator(dispatch, abortControllersRef.current),
    []
  );

  const initiateSSEExportConnection = useCallback(
    createExportInitiator(dispatch, abortControllersRef.current),
    []
  );

  const initiateSSEDropboxPublishConnection = useCallback(
    createDropboxPublishInitiator(dispatch, abortControllersRef.current),
    []
  );

  const initiateSSEPublishConnection = useCallback(
    createPublishInitiator(dispatch, abortControllersRef.current),
    []
  );

  // Stores repoId for Dropbox publish retries
  const dropboxPublishParamsRef = useRef<Map<string, { repoId: string }>>(
    new Map()
  );

  // Stores params for publish retries
  const publishParamsRef = useRef<
    Map<string, { courseId: string; name: string; description: string }>
  >(new Map());

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

      uploadParamsRef.current.set(uploadId, {
        description,
        privacyStatus,
        thumbnailId,
      });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        dependsOn,
      });

      if (!dependsOn) {
        initiateSSEConnection(
          uploadId,
          videoId,
          title,
          description,
          privacyStatus,
          thumbnailId
        );
      }

      return uploadId;
    },
    [initiateSSEConnection]
  );

  const startSocialUpload = useCallback(
    (videoId: string, title: string, caption: string) => {
      const uploadId = generateUploadId();

      socialParamsRef.current.set(uploadId, { caption });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "buffer",
      });

      initiateSSESocialConnection(uploadId, videoId, caption);

      return uploadId;
    },
    [initiateSSESocialConnection]
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

      aiHeroParamsRef.current.set(uploadId, { body, description, slug });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "ai-hero",
        dependsOn,
      });

      if (!dependsOn) {
        initiateSSEAiHeroConnection(
          uploadId,
          videoId,
          title,
          body,
          description,
          slug
        );
      }

      return uploadId;
    },
    [initiateSSEAiHeroConnection]
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

      skillsChangelogParamsRef.current.set(uploadId, {
        slug,
        body,
        description,
        newsletterSubject,
        newsletterPreviewText,
        newsletterCopy,
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
        initiateSSESkillsChangelogConnection(
          uploadId,
          videoId,
          title,
          slug,
          body,
          description,
          newsletterSubject,
          newsletterPreviewText,
          newsletterCopy
        );
      }

      return uploadId;
    },
    [initiateSSESkillsChangelogConnection]
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

      dropboxPublishParamsRef.current.set(uploadId, { repoId });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId: "",
        title: repoName,
        uploadType: "dropbox-publish",
      });

      initiateSSEDropboxPublishConnection(uploadId, repoId);

      return uploadId;
    },
    [initiateSSEDropboxPublishConnection]
  );

  const startPublish = useCallback(
    (
      courseId: string,
      courseName: string,
      name: string,
      description: string
    ) => {
      const uploadId = generateUploadId();

      publishParamsRef.current.set(uploadId, { courseId, name, description });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId: "",
        title: courseName,
        uploadType: "publish",
        courseId,
      });

      initiateSSEPublishConnection(uploadId, courseId, name, description);

      return uploadId;
    },
    [initiateSSEPublishConnection]
  );

  const dismissUpload = useCallback((uploadId: string) => {
    const abortController = abortControllersRef.current.get(uploadId);
    if (abortController) {
      abortController.abort();
      abortControllersRef.current.delete(uploadId);
    }
    uploadParamsRef.current.delete(uploadId);
    socialParamsRef.current.delete(uploadId);
    aiHeroParamsRef.current.delete(uploadId);
    skillsChangelogParamsRef.current.delete(uploadId);
    dropboxPublishParamsRef.current.delete(uploadId);
    publishParamsRef.current.delete(uploadId);
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
          retryConfig.initiate(
            uploadId,
            upload,
            undefined,
            dispatch,
            abortControllersRef.current
          );
        } else if (upload.uploadType === "buffer") {
          const params = socialParamsRef.current.get(uploadId);
          if (params) {
            initiateSSESocialConnection(
              uploadId,
              upload.videoId,
              params.caption
            );
          }
        } else if (upload.uploadType === "youtube") {
          const params = uploadParamsRef.current.get(uploadId);
          if (params) {
            initiateSSEConnection(
              uploadId,
              upload.videoId,
              upload.title,
              params.description,
              params.privacyStatus,
              params.thumbnailId
            );
          }
        } else if (upload.uploadType === "ai-hero") {
          const params = aiHeroParamsRef.current.get(uploadId);
          if (params) {
            initiateSSEAiHeroConnection(
              uploadId,
              upload.videoId,
              upload.title,
              params.body,
              params.description,
              params.slug
            );
          }
        } else if (upload.uploadType === "skills-changelog") {
          const params = skillsChangelogParamsRef.current.get(uploadId);
          if (params) {
            initiateSSESkillsChangelogConnection(
              uploadId,
              upload.videoId,
              upload.title,
              params.slug,
              params.body,
              params.description,
              params.newsletterSubject,
              params.newsletterPreviewText,
              params.newsletterCopy
            );
          }
        } else if (upload.uploadType === "dropbox-publish") {
          const params = dropboxPublishParamsRef.current.get(uploadId);
          if (params) {
            initiateSSEDropboxPublishConnection(uploadId, params.repoId);
          }
        } else if (upload.uploadType === "publish") {
          const params = publishParamsRef.current.get(uploadId);
          if (params) {
            initiateSSEPublishConnection(
              uploadId,
              params.courseId,
              params.name,
              params.description
            );
          }
        }
      }

      // Handle waiting → uploading transition (dependency completed)
      if (prevUpload.status === "waiting" && upload.status === "uploading") {
        const depConfig = uploadTypeRegistry[upload.uploadType];
        if (depConfig) {
          depConfig.initiate(
            uploadId,
            upload,
            undefined,
            dispatch,
            abortControllersRef.current
          );
        } else if (upload.uploadType === "youtube") {
          const params = uploadParamsRef.current.get(uploadId);
          if (params) {
            initiateSSEConnection(
              uploadId,
              upload.videoId,
              upload.title,
              params.description,
              params.privacyStatus,
              params.thumbnailId
            );
          }
        } else if (upload.uploadType === "ai-hero") {
          const params = aiHeroParamsRef.current.get(uploadId);
          if (params) {
            initiateSSEAiHeroConnection(
              uploadId,
              upload.videoId,
              upload.title,
              params.body,
              params.description,
              params.slug
            );
          }
        } else if (upload.uploadType === "skills-changelog") {
          const params = skillsChangelogParamsRef.current.get(uploadId);
          if (params) {
            initiateSSESkillsChangelogConnection(
              uploadId,
              upload.videoId,
              upload.title,
              params.slug,
              params.body,
              params.description,
              params.newsletterSubject,
              params.newsletterPreviewText,
              params.newsletterCopy
            );
          }
        } else if (upload.uploadType === "buffer") {
          const params = socialParamsRef.current.get(uploadId);
          if (params) {
            initiateSSESocialConnection(
              uploadId,
              upload.videoId,
              params.caption
            );
          }
        }
      }
    }

    previousUploadsRef.current = current;
  }, [
    state.uploads,
    initiateSSEConnection,
    initiateSSESocialConnection,
    initiateSSEAiHeroConnection,
    initiateSSESkillsChangelogConnection,
    initiateSSEDropboxPublishConnection,
    initiateSSEPublishConnection,
  ]);

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
