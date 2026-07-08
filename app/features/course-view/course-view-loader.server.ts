import { Effect } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { FeatureFlagService } from "@/services/feature-flag-service";
import {
  loadExportStatusMap,
  loadLessonFsMaps,
  toSlimVideo,
} from "@/services/course-loader-fs";
import { computeLessonWarnings } from "@/services/lesson-warnings";
import type { ExportClip } from "@/services/export-hash";
import { runtimeLive } from "@/services/layer.server";

/**
 * The shared course-view loader Effect, used by both the full course page and
 * the Section Workbench. Resolves the selected version, builds the slim
 * section→lesson→video→beat tree (Beat Descriptions included), and kicks
 * off the deferred filesystem/git/transcript work. Sections ending in
 * `ARCHIVE` are dropped here so every consumer agrees on the visible set.
 *
 * The Section Workbench wraps this and narrows `selectedCourse.sections` to a
 * single section — see `_app.courses.$courseId.sections.$sectionId.tsx`.
 */
export function courseViewEffect(input: {
  courseId: string;
  selectedVersionId: string | null;
  viewMode: "expanded" | "compact";
}) {
  return Effect.gen(function* () {
    const { courseId: selectedCourseId, selectedVersionId, viewMode } = input;
    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;
    const featureFlags = yield* FeatureFlagService;

    const courses = yield* courseOps.getCourses();

    const versions = yield* versionOps.getCourseVersions(selectedCourseId);

    let selectedVersion: Awaited<
      ReturnType<typeof versionOps.getLatestCourseVersion>
    > extends Effect.Effect<infer R, any, any>
      ? R
      : never = undefined;

    if (selectedVersionId) {
      selectedVersion = yield* versionOps
        .getCourseVersionById(selectedVersionId)
        .pipe(
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
        );
    } else {
      selectedVersion =
        yield* versionOps.getLatestCourseVersion(selectedCourseId);
    }

    const selectedCourse = yield* courseOps
      .getCourseWithSlimClipsById(selectedCourseId, selectedVersion?.id)
      .pipe(
        Effect.andThen((course) => {
          if (!course) {
            return undefined;
          }

          const allSections = course.versions[0]?.sections ?? [];

          return {
            ...course,
            sections: allSections.filter((section) => {
              // ARCHIVE sections are marked by a title ending in "ARCHIVE".
              // Detected on the title (the source of truth) rather than the
              // derived path, which is lowercased and absent for empty sections.
              return !section.title.toUpperCase().endsWith("ARCHIVE");
            }),
          };
        })
      );

    const allVideos = selectedCourse?.sections.flatMap((s) =>
      s.lessons.flatMap((l) => l.videos)
    );

    const slimCourse = selectedCourse
      ? (() => {
          const { versions, sections, ...courseRest } = selectedCourse;
          return {
            ...courseRest,
            sections: sections.map((section) => {
              const { lessons, ...sectionRest } = section;
              return {
                ...sectionRest,
                lessons: lessons.map((lesson) => {
                  const { videos, ...lessonRest } = lesson;
                  return {
                    ...lessonRest,
                    videos: videos.map(toSlimVideo),
                    lessonWarnings: computeLessonWarnings({ videos }),
                  };
                }),
              };
            }),
          };
        })()
      : undefined;

    const lessons: { id: string; fullPath: string }[] = [];

    const hasExportedVideoMap = selectedCourse
      ? runtimeLive.runPromise(
          loadExportStatusMap({
            courseId: selectedCourse.id,
            videos: (allVideos ?? []).map((v) => ({
              id: v.id,
              clips: v.clips as ExportClip[],
            })),
          })
        )
      : Promise.resolve({} as Record<string, boolean>);

    const lessonFsMaps = runtimeLive.runPromise(loadLessonFsMaps({ lessons }));

    const videoTranscripts = runtimeLive.runPromise(
      courseOps.getVideoTranscripts(selectedCourseId)
    );

    const latestVersion = versions[0];
    const isLatestVersion = !!(
      selectedVersion &&
      latestVersion &&
      selectedVersion.id === latestVersion.id
    );

    return {
      courses,
      selectedCourse: slimCourse,
      versions,
      selectedVersion,
      isLatestVersion,
      hasExportedVideoMap,
      lessonFsMaps,
      videoTranscripts,
      showMediaFilesList: featureFlags.isEnabled("ENABLE_MEDIA_FILES_LIST"),
      viewMode,
    };
  });
}
