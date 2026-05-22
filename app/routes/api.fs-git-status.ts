/**
 * Polling endpoint for filesystem and git status.
 *
 * Returns export maps, lesson filesystem maps, and git status
 * for the given course. Consumed by the useFsGitStatus hook.
 */

import {
  loadExportStatusMap,
  loadLessonFsMaps,
} from "@/services/course-loader-fs";
import type { ExportClip } from "@/services/export-hash";
import { getGitStatusAsync } from "@/services/git-status-service.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { Effect } from "effect";
import { data } from "react-router";
import type { Route } from "./+types/api.fs-git-status";

export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const courseId = url.searchParams.get("courseId");
  const versionId = url.searchParams.get("versionId");

  if (!courseId) {
    return data(
      {
        hasExportedVideoMap: {} as Record<string, boolean>,
        lessonFsMaps: {
          hasExplainerFolderMap: {} as Record<string, boolean>,
          lessonHasFilesMap: {} as Record<
            string,
            { path: string; size: number }[]
          >,
        },
        gitStatus: null,
      },
      { status: 200 }
    );
  }

  return Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;

    // Get the version to use
    let resolvedVersionId = versionId;
    if (!resolvedVersionId) {
      const latestVersion = yield* versionOps.getLatestCourseVersion(courseId);
      resolvedVersionId = latestVersion?.id ?? null;
    }

    const course = yield* courseOps
      .getCourseWithSlimClipsById(courseId, resolvedVersionId ?? undefined)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    if (!course) {
      return {
        hasExportedVideoMap: {} as Record<string, boolean>,
        lessonFsMaps: {
          hasExplainerFolderMap: {} as Record<string, boolean>,
          lessonHasFilesMap: {} as Record<
            string,
            { path: string; size: number }[]
          >,
        },
        gitStatus: null,
      };
    }

    const allSections = course.versions[0]?.sections ?? [];

    const allVideos = allSections.flatMap((s) =>
      s.lessons.flatMap((l) => l.videos)
    );

    const lessons = course.filePath
      ? allSections.flatMap((section) =>
          section.lessons
            .filter((lesson) => lesson.fsStatus !== "ghost")
            .map((lesson) => ({
              id: lesson.id,
              fullPath: `${course.filePath}/${section.path}/${lesson.path}`,
            }))
        )
      : [];

    const hasExportedVideoMap = yield* loadExportStatusMap({
      courseId: course.id,
      videos: allVideos.map((v) => ({
        id: v.id,
        clips: v.clips as ExportClip[],
      })),
    });

    const lessonFsMaps = yield* loadLessonFsMaps({ lessons });

    const gitStatus = course.filePath
      ? yield* Effect.promise(() => getGitStatusAsync(course.filePath!))
      : null;

    return { hasExportedVideoMap, lessonFsMaps, gitStatus };
  }).pipe(runtimeLive.runPromise);
};
