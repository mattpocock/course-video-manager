import { CourseRepoParserService } from "@/services/course-repo-parser";
import { Effect, Schema } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { makeAction } from "@/services/route-action.server";

const addRepoSchema = Schema.Struct({
  name: Schema.String,
  repoPath: Schema.String,
});

export const action = makeAction({
  input: "formData",
  errors: { CourseRepoDoesNotExistError: 404 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(addRepoSchema)(payload);

      const repoParserService = yield* CourseRepoParserService;

      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const parsedSections = yield* repoParserService.parseRepo(
        result.repoPath
      );
      console.log(parsedSections);

      const repo = yield* courseOps.createCourse({
        filePath: result.repoPath,
        name: result.name,
      });

      const version = yield* versionOps.createCourseVersion({
        repoId: repo.id,
        name: "v1.0",
      });

      const sections = yield* lessonSectionOps.createSections({
        sections: parsedSections,
        repoVersionId: version.id,
      });

      yield* Effect.forEach(sections, (section, index) =>
        Effect.forEach(parsedSections[index]!.lessons, (lesson) =>
          lessonSectionOps.createLessons(section.id, [lesson])
        )
      );

      return {
        id: repo.id,
      };
    }),
});
