import type { Dispatch } from "react";
import { startSSEAiHeroPost } from "./sse-ai-hero-client";
import { startSSESkillsChangelogPost } from "./sse-skills-changelog-client";
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

export function createAiHeroInitiator(
  dispatch: AnyDispatch,
  abortControllers: Map<string, AbortController>
) {
  return (
    uploadId: string,
    videoId: string,
    title: string,
    body: string,
    description: string,
    slug: string
  ) => {
    const existing = abortControllers.get(uploadId);
    if (existing) existing.abort();

    const abortController = startSSEAiHeroPost(
      { videoId, title, body, description, slug },
      {
        onProgress: (percentage) => {
          dispatch({ type: "UPDATE_PROGRESS", uploadId, progress: percentage });
        },
        onComplete: (aiHeroSlug) => {
          dispatch({ type: "UPLOAD_SUCCESS", uploadId, aiHeroSlug });
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

export function createSkillsChangelogInitiator(
  dispatch: AnyDispatch,
  abortControllers: Map<string, AbortController>
) {
  return (
    uploadId: string,
    videoId: string,
    title: string,
    slug: string,
    body: string,
    description: string,
    newsletterSubject: string,
    newsletterPreviewText: string,
    newsletterCopy: string
  ) => {
    const existing = abortControllers.get(uploadId);
    if (existing) existing.abort();

    const abortController = startSSESkillsChangelogPost(
      {
        videoId,
        title,
        slug,
        body,
        description,
        newsletterSubject,
        newsletterPreviewText,
        newsletterCopy,
      },
      {
        onProgress: (percentage) => {
          dispatch({ type: "UPDATE_PROGRESS", uploadId, progress: percentage });
        },
        onComplete: (skillsChangelogSlug) => {
          dispatch({
            type: "UPLOAD_SUCCESS",
            uploadId,
            skillsChangelogSlug,
          });
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
