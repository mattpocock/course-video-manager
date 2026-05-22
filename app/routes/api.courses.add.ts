import { CourseRepoParserService } from "@/services/course-repo-parser";
import type { Route } from "./+types/api.courses.add";
import { Console, Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const addRepoSchema = Schema.Struct({
  name: Schema.String,
  repoPath: Schema.String,
});

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const formDataObject = Object.fromEntries(formData);

  return await Effect.gen(function* () {
    const result = yield* Schema.decodeUnknown(addRepoSchema)(formDataObject);

    const repoParserService = yield* CourseRepoParserService;

    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;
    const lessonSectionOps = yield* LessonSectionOperationsService;

    const parsedSections = yield* repoParserService.parseRepo(result.repoPath);
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
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => {
      return Console.dir(e, { depth: null });
    }),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("CourseRepoDoesNotExistError", () => {
      return Effect.die(
        data("Repo path does not exist locally", { status: 404 })
      );
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
