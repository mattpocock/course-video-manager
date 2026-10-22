import { CLIP_MOCKUP_VOICE_JOB_KIND } from "@cvm/core/features/clip-mockups/voice-status";
import { isPostingJobKind } from "./job-wire";
import { isUntoastedJobKind } from "./transcribe-footage-job";
import { isImageUploadJobKind } from "@/features/image-upload/image-upload-job";
import type { jobsReducer } from "./jobs-reducer";
import { DUPLICATE_COURSE_JOB_KIND } from "./duplicate-course-job";
import { jobUploadEntries, jobUploadEntry } from "./jobs-selectors";

/**
 * What a Job's success toast says and links to, decided by the reducer when
 * the Job settles, so the toast never reads state to build itself.
 *
 * - a post toasts as the browser-driven upload did (same words, same links;
 *   AI Hero and the Skills Changelog also save their link to the global links);
 * - a Publish says "published successfully", with "Go to Draft";
 * - an Autofill says "<title> finished", with "Back to Publish";
 * - every other kind is `generic`: "<title> <did>", with **Open** to reveal
 *   the exported file when there is one.
 */
export type SucceededToast =
  | { shape: "youtube"; videoId: string; youtubeVideoId: string | null }
  | { shape: "youtube-shorts"; youtubeVideoId: string | null }
  | { shape: "buffer"; videoId: string }
  | { shape: "ai-hero"; videoId: string; slug: string | null }
  | { shape: "skills-changelog"; videoId: string; slug: string | null }
  | { shape: "publish"; courseId: string; newDraftVersionId: string | null }
  | { shape: "autofill"; courseId: string }
  | { shape: "generic"; did: string; revealVideoId: string | null };

/** What a kind of Job did, for a generic toast's headline. */
const DID: Record<string, string> = {
  export: "exported successfully",
  "export-animatic": "exported to finished-videos",
  "render-vertical": "rendered as a vertical Short",
};

/** The `generic` toast for a Job of `kind` about `subjectId`. */
export const genericSucceededToast = (
  kind: string,
  subjectId: string | null
): SucceededToast => ({
  shape: "generic",
  did: DID[kind] ?? "finished",
  // The export's toast as the browser-driven export showed it.
  revealVideoId: kind === "export" ? subjectId : null,
});

/** The toast for Job `job`, which has just succeeded. */
export const succeededToastOf = (job: jobsReducer.JobView): SucceededToast => {
  const entry = isPostingJobKind(job.kind)
    ? jobUploadEntry(job)
    : job.kind === "autofill" || job.kind === "publish"
      ? (jobUploadEntries(job)[0] ?? null)
      : null;
  switch (entry?.uploadType) {
    case "youtube":
      return {
        shape: "youtube",
        videoId: entry.videoId,
        youtubeVideoId: entry.youtubeVideoId,
      };
    case "youtube-shorts":
      return { shape: "youtube-shorts", youtubeVideoId: entry.youtubeVideoId };
    case "buffer":
      return { shape: "buffer", videoId: entry.videoId };
    case "ai-hero":
      return {
        shape: "ai-hero",
        videoId: entry.videoId,
        slug: entry.aiHeroSlug,
      };
    case "skills-changelog":
      return {
        shape: "skills-changelog",
        videoId: entry.videoId,
        slug: entry.skillsChangelogSlug,
      };
    case "publish":
      return {
        shape: "publish",
        courseId: entry.courseId,
        newDraftVersionId: entry.newDraftVersionId,
      };
    case "autofill":
      return { shape: "autofill", courseId: entry.courseId };
    // An export or a render draws a row of its own, but its toast is generic.
    case "export":
    case "render-vertical":
    // A Course duplicate never toasts its success (`isSilentSettlement`).
    case "duplicate-course":
    case "storage-move":
    case "storage-delete":
    case undefined:
      return genericSucceededToast(job.kind, job.subjectId);
  }
};

/** A settled Job that never toasts at all, whatever its outcome says. */
export const isSilentSettlement = (job: jobsReducer.JobView): boolean => {
  const succeeded = job.status === "succeeded";
  // A Batch export toasts each Video as it finishes (as the browser did), and
  // nothing for the batch itself; only its failure is news.
  if (job.kind === "batch-export" && succeeded) return true;
  if (isUntoastedJobKind(job.kind)) return true;
  // A Clip Mockup's voice shows on the Clip Mockup, and never toasts: its
  // failure shows there (`voiceStatus: failed`, with why) and in the Jobs
  // list, with the Job's log. It usually ends while nobody is watching.
  if (job.kind === CLIP_MOCKUP_VOICE_JOB_KIND) return true;
  // A Course duplicate's row links to the copy; only its failure is news.
  if (job.kind === DUPLICATE_COURSE_JOB_KIND && succeeded) return true;
  // An image upload shows in the body it changed; only its failure is news.
  return isImageUploadJobKind(job.kind) && succeeded;
};
