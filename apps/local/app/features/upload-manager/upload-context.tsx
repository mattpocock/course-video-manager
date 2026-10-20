import { createContext, useCallback, useContext, useMemo } from "react";
import type { PlaceholderFloorBand } from "@/packages/course-json/client";
import {
  historyLookupOf,
  type HistoryLookup,
} from "@/features/jobs/job-stage-history";
import { useJobs, type SubscribeToJobJoins } from "@/features/jobs/use-jobs";
import type { jobsReducer } from "@/features/jobs/jobs-reducer";
import type { SubscribeToJobEvents } from "@/features/jobs/job-event-hub";
import { TRANSCRIBE_CLIPS_JOB_KIND } from "@/features/video-editor/transcribe-clips-response";
import {
  REMOVE_LOCAL_IMAGES_JOB_KIND,
  UPLOAD_IMAGES_JOB_KIND,
} from "@/features/image-upload/image-upload-job";

export interface UploadContextType {
  /** Background Jobs the Sidecar runs (a Video export), as this tab sees them. */
  jobs: jobsReducer.State;
  dismissJob: (jobId: string) => void;
  /** Hear Job Events as they arrive (the recent ones first). */
  subscribeToJobEvents: SubscribeToJobEvents;
  /** Hear this tab's requests the server answered with another, live Job. */
  subscribeToJobJoins: SubscribeToJobJoins;
  /**
   * The author's Retry on a failed or interrupted post: the only way a post
   * runs again (posts never retry on their own).
   */
  retryJob: (jobId: string) => void;
  /** The author's Cancel on a Job that can be cancelled (a Storage move). */
  cancelJob: (jobId: string) => void;
  /** Hide every succeeded Job: the Global Upload Progress's idle timer. */
  dismissFinishedJobs: () => void;
  /**
   * "Clear finished": dismiss every settled Job's rows. The dismissal is kept
   * on the server.
   */
  clearFinished: () => void;
  /** Inputs to the ETA: see `estimateUploads`. */
  etaHistory: HistoryLookup;
  clock: () => number;
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
  /**
   * Export a Video: a background Job the Sidecar runs, so it carries on when
   * the tab closes. Returns the Job's id, which an upload may wait on.
   */
  startExportUpload: (videoId: string, title: string) => string;
  /**
   * Render a Video as a vertical Short: a background Job the Sidecar runs.
   * Returns the Job's id, which a Shorts post may wait on.
   */
  startRenderVerticalUpload: (videoId: string, title: string) => string;
  /**
   * Export every Video of a Course Version that is not yet exported: a
   * background Job the Sidecar runs, drawn as one row per Video.
   */
  startBatchExportUpload: (
    versionId: string,
    includeTodoLessons: boolean,
    title: string
  ) => void;
  startPublish: (
    courseId: string,
    courseName: string,
    name: string,
    description: string,
    includeTodoLessons: boolean,
    /** The Placeholder Floor the publish page showed, as its band. */
    placeholders: PlaceholderFloorBand,
    /** The Autofill this Publish waits on, when one runs first. */
    dependsOn?: string
  ) => string;
  startAutofill: (
    courseId: string,
    courseName: string,
    versionId: string,
    includeTodoLessons: boolean
  ) => string;
  /**
   * Transcribe a Video's Clips: a `transcribe-clips` Job the Sidecar runs,
   * under the id the editor made. It draws no row; its Job Events come back
   * to the editor (`subscribeToJobEvents`).
   */
  startClipTranscription: (
    jobId: string,
    videoId: string,
    clipIds: readonly string[]
  ) => void;
  /**
   * Upload a body's local images to Cloudinary: an `upload-images` Job the
   * Sidecar runs, under the id the caller made. It draws no row, and toasts
   * only a failure; its Job Events come back to the caller
   * (`features/image-upload/use-image-upload-job.ts`).
   */
  startImageUpload: (jobId: string, videoId: string, body: string) => void;
  /** Remove local image files whose Cloudinary URLs went into a body. */
  removeLocalImages: (videoId: string, filePaths: readonly string[]) => void;
}

export const UploadContext = createContext<UploadContextType>(null!);

/** Everything in {@link UploadContextType} but the live Jobs state. */
export type UploadActions = Omit<UploadContextType, "jobs" | "etaHistory">;

const UploadActionsContext = createContext<UploadActions>(null!);

/**
 * The ways to start and manage Jobs, without the Jobs state. Its value never
 * changes, so a page that only starts Jobs does not re-render for every Job
 * Event the tab hears — a page that replays dozens of them on load (every
 * page) would otherwise re-render its whole tree once per event. Read
 * {@link UploadContext} only when the Jobs themselves are drawn.
 */
export function useUploadActions(): UploadActions {
  return useContext(UploadActionsContext);
}

export function UploadProvider({
  children,
  clock = Date.now,
}: {
  children: React.ReactNode;
  /** "Now" for the ETA, so the ETA never reads a clock itself. */
  clock?: () => number;
}) {
  // Every kind of background work is a Job the Sidecar runs: the tab only
  // enqueues it and draws its Job Events.
  const jobs = useJobs();
  const { startJob } = jobs;

  // The ETA's stage history, read from `job_event` by the jobs reducer.
  const stageHistory = jobs.state.stageHistory;
  const etaHistory = useMemo(
    () => historyLookupOf(stageHistory),
    [stageHistory]
  );

  // A YouTube upload is a posting Job: the Sidecar runs it once, and only
  // after the Job it waits on (its export) has succeeded.
  const startUpload = useCallback(
    (
      videoId: string,
      title: string,
      description: string,
      privacyStatus: "public" | "unlisted",
      thumbnailId: string,
      dependsOn?: string
    ) =>
      startJob({
        kind: "youtube",
        title,
        params: { videoId, title, description, privacyStatus, thumbnailId },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  // A Buffer post is a posting Job: run once, after its render succeeds.
  const startSocialUpload = useCallback(
    (videoId: string, title: string, caption: string, dependsOn?: string) =>
      startJob({
        kind: "buffer",
        title,
        params: { videoId, caption },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  // A Shorts post is a posting Job: run once, after its render succeeds.
  const startYoutubeShortsUpload = useCallback(
    (videoId: string, title: string, description: string, dependsOn?: string) =>
      startJob({
        kind: "youtube-shorts",
        title,
        params: { videoId, title, description },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  // AI Hero and Skills Changelog posts are posting Jobs: run once, after
  // their export succeeds.
  const startAiHeroUpload = useCallback(
    (
      videoId: string,
      title: string,
      body: string,
      description: string,
      slug: string,
      dependsOn?: string
    ) =>
      startJob({
        kind: "ai-hero",
        title,
        params: { videoId, title, body, description, slug },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
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
    ) =>
      startJob({
        kind: "skills-changelog",
        title,
        params: {
          videoId,
          title,
          slug,
          body,
          description,
          newsletterSubject,
          newsletterPreviewText,
          newsletterCopy,
        },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  const startExportUpload = useCallback(
    (videoId: string, title: string) =>
      startJob({
        kind: "export",
        title,
        params: { videoId },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: null,
      }),
    [startJob]
  );

  const startRenderVerticalUpload = useCallback(
    (videoId: string, title: string) =>
      startJob({
        kind: "render-vertical",
        title,
        params: { videoId },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: null,
      }),
    [startJob]
  );

  const startBatchExportUpload = useCallback(
    (versionId: string, includeTodoLessons: boolean, title: string) => {
      startJob({
        kind: "batch-export",
        title,
        params: { versionId, includeTodoLessons },
        subject: { type: "course-version", id: versionId },
        attemptsSpent: 0,
        dependsOn: null,
      });
    },
    [startJob]
  );

  // A Publish is a background Job: the Sidecar runs it in the `publish`
  // lane, one at a time, so closing the tab no longer stops it. It runs once
  // and is never re-run on its own: a Publish cut off after Submit leaves a
  // Pending Version for the publish page's Promote / Discard. It waits on the
  // Course Autofill the publish page starts first, when there is one, and
  // fails with it.
  const startPublish = useCallback(
    (
      courseId: string,
      courseName: string,
      name: string,
      description: string,
      includeTodoLessons: boolean,
      placeholders: PlaceholderFloorBand,
      dependsOn?: string
    ) =>
      startJob({
        kind: "publish",
        title: courseName,
        params: {
          courseId,
          name,
          description,
          includeTodoLessons,
          placeholders,
        },
        subject: { type: "course", id: courseId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  // A Course Autofill is a background Job: the Sidecar runs it, so closing
  // the tab no longer stops it. Its rows come from its Job Events.
  const startAutofill = useCallback(
    (
      courseId: string,
      courseName: string,
      versionId: string,
      includeTodoLessons: boolean
    ) =>
      startJob({
        kind: "autofill",
        title: `Autofill ${courseName}`,
        params: { courseId, versionId, includeTodoLessons },
        subject: { type: "course", id: courseId },
        attemptsSpent: 0,
        dependsOn: null,
      }),
    [startJob]
  );

  // A Clip transcription is a Job too. Enqueueing through the jobs reducer
  // asks again, under the same id, when an answer is lost, so a dropped
  // response never fails Clips that were queued after all.
  const startClipTranscription = useCallback(
    (jobId: string, videoId: string, clipIds: readonly string[]) => {
      startJob({
        id: jobId,
        kind: TRANSCRIBE_CLIPS_JOB_KIND,
        title: `Transcribe ${clipIds.length} ${clipIds.length === 1 ? "Clip" : "Clips"}`,
        params: { clipIds: [...clipIds] },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: null,
      });
    },
    [startJob]
  );

  // Uploading a body's images is a Job too, so closing the tab mid-upload
  // loses nothing: every upload is recorded before anything acts on it.
  const startImageUpload = useCallback(
    (jobId: string, videoId: string, body: string) => {
      startJob({
        id: jobId,
        kind: UPLOAD_IMAGES_JOB_KIND,
        title: "Upload images to Cloudinary",
        params: { videoId, body },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: null,
      });
    },
    [startJob]
  );

  const removeLocalImages = useCallback(
    (videoId: string, filePaths: readonly string[]) => {
      startJob({
        kind: REMOVE_LOCAL_IMAGES_JOB_KIND,
        title: "Remove uploaded local images",
        params: { videoId, filePaths: [...filePaths] },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: null,
      });
    },
    [startJob]
  );

  const {
    dismissJob,
    subscribeToJobEvents,
    subscribeToJobJoins,
    retryJob,
    cancelJob,
    dismissFinishedJobs,
    clearFinishedJobs,
  } = jobs;
  const actions = useMemo<UploadActions>(
    () => ({
      dismissJob,
      subscribeToJobEvents,
      subscribeToJobJoins,
      retryJob,
      cancelJob,
      dismissFinishedJobs,
      clearFinished: clearFinishedJobs,
      clock,
      startUpload,
      startSocialUpload,
      startYoutubeShortsUpload,
      startAiHeroUpload,
      startSkillsChangelogUpload,
      startExportUpload,
      startRenderVerticalUpload,
      startBatchExportUpload,
      startPublish,
      startAutofill,
      startClipTranscription,
      startImageUpload,
      removeLocalImages,
    }),
    [
      dismissJob,
      subscribeToJobEvents,
      subscribeToJobJoins,
      retryJob,
      cancelJob,
      dismissFinishedJobs,
      clearFinishedJobs,
      clock,
      startUpload,
      startSocialUpload,
      startYoutubeShortsUpload,
      startAiHeroUpload,
      startSkillsChangelogUpload,
      startExportUpload,
      startRenderVerticalUpload,
      startBatchExportUpload,
      startPublish,
      startAutofill,
      startClipTranscription,
      startImageUpload,
      removeLocalImages,
    ]
  );
  const value = useMemo<UploadContextType>(
    () => ({ ...actions, jobs: jobs.state, etaHistory }),
    [actions, jobs.state, etaHistory]
  );

  return (
    <UploadActionsContext.Provider value={actions}>
      <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
    </UploadActionsContext.Provider>
  );
}
