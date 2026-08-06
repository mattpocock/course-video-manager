import { computeEffectiveSections } from "@/packages/course-json";
import { computeVideoWarnings } from "./video-warnings";

/**
 * AUTOFILL CANDIDATES — "which Videos has the Autofill got work for?".
 *
 * Exported apart from the run itself, because the publish page's button count
 * ("Autofill 4 Videos") and what the run actually does are the same rule. Two
 * implementations of it would be free to disagree, and the first sign of that
 * would be a button that promises work it then does not do.
 *
 * The rules, in the order they decide:
 *
 *   No **Body**       → not a candidate AT ALL, and not merely for its
 *                       `description`. The description is written from the
 *                       Body, so without one there is nothing to write from —
 *                       and a Video with no Body is Matt's work, not the
 *                       Autofill's.
 *   `description`     → a candidate only when the field is empty. Existing
 *                       text is never overwritten, so running twice is safe.
 *   **Chapters**      → a candidate only when the Video raises **Missing
 *                       Chapters** AND every **Clip** is transcribed. Chapters
 *                       are written from the Transcript, and chapters placed
 *                       by hand are never destroyed.
 *
 * A Video needing neither is not a candidate and gets no progress row — the
 * run's list is about work, not about exclusions.
 */

/** The two fields the Autofill owns. */
export type AutofillField = "description" | "chapters";

export type AutofillCandidate = {
  readonly videoId: string;
  /** `section/lesson/title` — the label its progress row carries. */
  readonly title: string;
  readonly fields: readonly AutofillField[];
};

/**
 * Why a Video with outstanding Autofill-owned work is being left alone. The
 * publish page shows these, so a missing row in the progress list is never a
 * mystery.
 */
export type AutofillSkipReason = "no-body" | "untranscribed-clips";

export type AutofillSkip = {
  readonly videoId: string;
  readonly title: string;
  readonly reason: AutofillSkipReason;
};

type CandidateClip = {
  readonly order: string;
  readonly archived: boolean;
  readonly transcribedAt: Date | null;
};

type CandidateVideo = {
  readonly id: string;
  readonly title: string;
  readonly archived: boolean;
  readonly lessonId?: string | null;
  readonly body?: string | null;
  readonly description?: string | null;
  readonly clips: readonly CandidateClip[];
  readonly chapters: readonly {
    readonly order: string;
    readonly archived: boolean;
  }[];
};

type CandidateLesson = {
  readonly path?: string;
  readonly authoringStatus: string | null;
  readonly videos: readonly CandidateVideo[];
};

type CandidateSection = {
  readonly path?: string;
  readonly lessons: readonly CandidateLesson[];
};

export type AutofillSelection = {
  readonly candidates: readonly AutofillCandidate[];
  readonly skipped: readonly AutofillSkip[];
};

/**
 * Walks the effective output — the exact Videos this **Publish** would ship
 * under the given to-do setting — and splits them into what the Autofill will
 * do and what it is leaving behind.
 */
export const selectAutofillCandidates = (
  sections: readonly CandidateSection[],
  includeTodoLessons: boolean
): AutofillSelection => {
  const candidates: AutofillCandidate[] = [];
  const skipped: AutofillSkip[] = [];

  for (const section of computeEffectiveSections(
    sections,
    includeTodoLessons
  )) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        if (video.archived) continue;
        const title = `${section.path ?? ""}/${lesson.path ?? ""}/${video.title}`;

        const warnings = computeVideoWarnings({
          clips: [...video.clips],
          chapters: [...video.chapters],
          lessonId: video.lessonId,
          body: video.body,
          description: video.description,
        });
        const raisesMissingChapters = warnings.some(
          (warning) => warning.kind === "missingChapters"
        );
        const needsDescription = !video.description?.trim();
        if (!needsDescription && !raisesMissingChapters) continue;

        // The Body is the precondition for the whole feature: it is written by
        // hand, and nothing downstream of it can be invented without it.
        if (!video.body?.trim()) {
          skipped.push({ videoId: video.id, title, reason: "no-body" });
          continue;
        }

        const liveClips = video.clips.filter((clip) => !clip.archived);
        const allTranscribed =
          liveClips.length > 0 &&
          liveClips.every((clip) => clip.transcribedAt !== null);

        const fields: AutofillField[] = [];
        if (needsDescription) fields.push("description");
        if (raisesMissingChapters && allTranscribed) fields.push("chapters");

        // Partial readiness still makes progress: an untranscribed Video is
        // skipped for its Chapters and still written a description.
        if (raisesMissingChapters && !allTranscribed) {
          skipped.push({
            videoId: video.id,
            title,
            reason: "untranscribed-clips",
          });
        }

        if (fields.length > 0) {
          candidates.push({ videoId: video.id, title, fields });
        }
      }
    }
  }

  return { candidates, skipped };
};
