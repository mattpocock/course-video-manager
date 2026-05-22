import { Console, Effect } from "effect";
import type { Route } from "./+types/api.lessons.$lessonId.open-repo-parent";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { OpenFolderService } from "@/services/open-folder-service";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import path from "node:path";

export const action = async (args: Route.ActionArgs) => {
  const lessonId = args.params.lessonId;

  return Effect.gen(function* () {
    const lessonSectionOps = yield* LessonSectionOperationsService;
    const openFolder = yield* OpenFolderService;

    const lesson = yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);
    const repo = lesson.section.repoVersion.repo;

    yield* openFolder.openInVSCode(path.dirname(repo.filePath!));

    return { success: true };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.succeed(
        data({ error: "Lesson not found" }, { status: 404 })
      );
    }),
    Effect.catchAll(() => {
      return Effect.succeed(
        data({ error: "Failed to open VS Code" }, { status: 500 })
      );
    }),
    runtimeLive.runPromise
  );
};
