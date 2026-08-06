import { AlertTriangle } from "lucide-react";
import { LESSON_WARNING_LABELS } from "@/features/course-view/lesson-warning-labels";
import { VIDEO_WARNING_LABELS } from "@/features/course-view/video-warning-labels";
import type { CourseViewLint } from "@/services/lesson-warnings";
import type { AutofillSkipReason } from "@/services/autofill-candidates";
import type {
  IncompleteVideo,
  InvalidLessonCombo,
} from "@/packages/course-json";

export interface PublishBlockerLists {
  readonly courseViewLints: readonly CourseViewLint[];
  readonly incompleteVideos: readonly IncompleteVideo[];
  readonly invalidLessonCombos: readonly InvalidLessonCombo[];
}

function BlockerPanel({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-amber-500" />
        <span className="text-sm font-medium text-amber-500">{heading}</span>
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

/**
 * Every reason this Course cannot ship, itemised rather than merely counted so
 * each one can be found and fixed. The label wording matches the course view
 * exactly, keeping the two surfaces in lockstep.
 */
export function PublishBlockers({ lists }: { lists: PublishBlockerLists }) {
  const { courseViewLints, incompleteVideos, invalidLessonCombos } = lists;

  return (
    <>
      {courseViewLints.length > 0 && (
        <BlockerPanel
          heading={`${courseViewLints.length} course warning${
            courseViewLints.length !== 1 ? "s" : ""
          } — fix in the course view before publishing`}
        >
          {courseViewLints.map((lint, index) => (
            <li
              key={`${lint.sectionPath}/${lint.lessonPath}/${
                lint.scope === "video" ? lint.videoTitle : "lesson"
              }/${lint.kind}/${index}`}
              className="text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {lint.scope === "video"
                  ? lint.videoTitle
                  : lint.lessonPath || "Lesson"}
              </span>{" "}
              <span className="text-amber-500">
                (
                {lint.scope === "video"
                  ? VIDEO_WARNING_LABELS[lint.kind]
                  : LESSON_WARNING_LABELS[lint.kind]}
                )
              </span>
              <span className="block text-muted-foreground/70">
                {lint.sectionPath}
                {lint.scope === "video" && lint.lessonPath
                  ? ` / ${lint.lessonPath}`
                  : ""}
              </span>
            </li>
          ))}
        </BlockerPanel>
      )}

      {/* Incomplete Videos — a shipping video missing clips, body, or
          description. Every field in course.json is required, so publishing
          one would fail the build; block it here (see ADR 0019). */}
      {incompleteVideos.length > 0 && (
        <BlockerPanel
          heading={`${incompleteVideos.length} incomplete video${
            incompleteVideos.length !== 1 ? "s" : ""
          } — finish ${
            incompleteVideos.length !== 1 ? "these" : "this"
          } before publishing`}
        >
          {incompleteVideos.map((video) => (
            <li
              key={`${video.sectionPath}/${video.lessonPath}/${video.videoTitle}`}
              className="text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {video.videoTitle}
              </span>{" "}
              <span className="text-amber-500">
                (missing {video.missing.join(", ")})
              </span>
              <span className="block text-muted-foreground/70">
                {video.sectionPath} / {video.lessonPath}
              </span>
            </li>
          ))}
        </BlockerPanel>
      )}

      {/* Invalid Lesson Role Combos — a lesson whose videos don't form a valid
          explainer / problem / solution combo. buildCourseJson can't resolve
          it, so block publish until the roles are fixed in the course view. */}
      {invalidLessonCombos.length > 0 && (
        <BlockerPanel
          heading={`${invalidLessonCombos.length} lesson${
            invalidLessonCombos.length !== 1 ? "s" : ""
          } with an invalid video combo — fix in the course view before publishing`}
        >
          {invalidLessonCombos.map((lesson) => (
            <li
              key={`${lesson.sectionPath}/${lesson.lessonPath}`}
              className="text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {lesson.lessonPath}
              </span>{" "}
              <span className="text-amber-500">
                ({lesson.videoTitles.join(", ")})
              </span>
              <span className="block text-muted-foreground/70">
                {lesson.sectionPath}
              </span>
            </li>
          ))}
        </BlockerPanel>
      )}
    </>
  );
}

const AUTOFILL_SKIP_LABELS: Record<AutofillSkipReason, string> = {
  "no-body": "no lesson body yet — the Autofill writes from the body",
  "untranscribed-clips": "clips still transcribing — chapters can't be written",
};

/**
 * Why a Video the Autofill will not touch is missing from the run's progress
 * list. Without this a skipped Video is simply an absence, and an absence is
 * indistinguishable from a bug.
 */
export function AutofillSkipList({
  skipped,
}: {
  skipped: ReadonlyArray<{
    videoId: string;
    title: string;
    reason: AutofillSkipReason;
  }>;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium mb-1.5">
        {skipped.length} video{skipped.length !== 1 ? "s" : ""} the Autofill
        can&apos;t help with
      </p>
      <ul className="space-y-1">
        {skipped.map((skip) => (
          <li key={`${skip.videoId}/${skip.reason}`} className="text-xs">
            <span className="text-foreground">{skip.title}</span>
            <span className="block text-muted-foreground/70">
              {AUTOFILL_SKIP_LABELS[skip.reason]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
