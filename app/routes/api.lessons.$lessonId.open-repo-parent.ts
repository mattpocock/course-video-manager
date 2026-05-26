import { Effect } from "effect";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { OpenFolderService } from "@/services/open-folder-service";
import { makeAction } from "@/services/route-action.server";
import path from "node:path";

export const action = makeAction({
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const lessonSectionOps = yield* LessonSectionOperationsService;
      const openFolder = yield* OpenFolderService;

      const lesson = yield* lessonSectionOps.getLessonWithHierarchyById(
        params.lessonId!
      );
      const repo = lesson.section.repoVersion.repo;

      yield* openFolder.openInVSCode(path.dirname(repo.filePath!));

      return { success: true };
    }),
});
