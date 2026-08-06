import { AlertTriangle, ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { autofillFieldClearing } from "@/services/video-warnings";
import { LESSON_WARNING_LABELS } from "@/features/course-view/lesson-warning-labels";
import { VIDEO_WARNING_LABELS } from "@/features/course-view/video-warning-labels";
import { autofillVideoKey } from "@/services/autofill-candidates";
import type { CourseViewLint } from "@/services/lesson-warnings";
import type {
  AutofillCandidate,
  AutofillSkipReason,
} from "@/services/autofill-candidates";
import type {
  IncompleteVideo,
  InvalidLessonCombo,
} from "@/packages/course-json";

export interface PublishBlockerLists {
  readonly courseViewLints: readonly CourseViewLint[];
  readonly incompleteVideos: readonly IncompleteVideo[];
  readonly invalidLessonCombos: readonly InvalidLessonCombo[];
}

/**
 * Which blockers one press of the **Autofill** would clear.
 *
 * Eight blockers should not read as eight problems when six of them are one
 * button press, so the clearable ones collapse and the ones only Matt can fix
 * — a missing **Body**, an invalid Lesson role combo — stay in plain sight.
 * Nothing is hidden: every blocker is still listed, and all of them still
 * refuse a release.
 *
 * Clearability is read off the **Autofill Candidates** themselves rather than
 * re-derived from the warning kind, because the two can differ: a Video with
 * no **Body** raises `missingDescription` and a Video with untranscribed
 * **Clips** raises `missingChapters`, yet the run touches neither. Deriving it
 * a second way here would let the accordion promise work the run will not do —
 * the one rule, in one place, that `selectAutofillCandidates` exists to be.
 */
export const splitAutofillClearable = (
  lists: PublishBlockerLists,
  candidates: readonly AutofillCandidate[]
): { clearable: PublishBlockerLists; mine: PublishBlockerLists } => {
  const fieldsByVideo = new Map(
    candidates.map((candidate) => [candidate.title, candidate.fields])
  );
  const willWrite = (
    video: { sectionPath: string; lessonPath: string; videoTitle: string },
    field: "description" | "chapters"
  ) => !!fieldsByVideo.get(autofillVideoKey(video))?.includes(field);

  const clearableLint = (lint: CourseViewLint) => {
    if (lint.scope !== "video") return false;
    const field = autofillFieldClearing(lint.kind);
    return field !== undefined && willWrite(lint, field);
  };

  // A Video missing only its description is one press away — but only if the
  // run will actually write it. One missing its Body or its Clips is not, and
  // a Video missing both is Matt's.
  const clearableVideo = (video: IncompleteVideo) =>
    video.missing.length > 0 &&
    video.missing.every((field) => field === "description") &&
    willWrite(video, "description");

  return {
    clearable: {
      courseViewLints: lists.courseViewLints.filter(clearableLint),
      incompleteVideos: lists.incompleteVideos.filter(clearableVideo),
      invalidLessonCombos: [],
    },
    mine: {
      courseViewLints: lists.courseViewLints.filter(
        (lint) => !clearableLint(lint)
      ),
      incompleteVideos: lists.incompleteVideos.filter(
        (video) => !clearableVideo(video)
      ),
      invalidLessonCombos: lists.invalidLessonCombos,
    },
  };
};

const countBlockers = (lists: PublishBlockerLists) =>
  lists.courseViewLints.length +
  lists.incompleteVideos.length +
  lists.invalidLessonCombos.length;

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
 * each one can be found and fixed — with the ones the **Autofill** would clear
 * folded away, so what stays in plain sight is the work only Matt can do.
 */
export function PublishBlockers({
  lists,
  candidates,
}: {
  lists: PublishBlockerLists;
  candidates: readonly AutofillCandidate[];
}) {
  const { clearable, mine } = splitAutofillClearable(lists, candidates);
  const clearableCount = countBlockers(clearable);

  return (
    <>
      <BlockerLists lists={mine} />
      {clearableCount > 0 && (
        <Collapsible className="mb-8 rounded-lg border border-border p-4">
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full text-left">
            <ChevronRight className="w-4 h-4 shrink-0 transition-transform data-[state=open]:rotate-90" />
            {clearableCount} blocker{clearableCount !== 1 ? "s" : ""} the
            Autofill will clear
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <BlockerLists lists={clearable} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

function BlockerLists({ lists }: { lists: PublishBlockerLists }) {
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
