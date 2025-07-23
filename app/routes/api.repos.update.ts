import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { Console, Data, Effect, Schema } from "effect";
import type { Route } from "./+types/api.repos.update";
import {
  getSectionAndLessonNumberFromPath,
  notFound,
} from "@/services/repo-parser";

const lessonPathSchema = Schema.String.pipe(
  Schema.filter((path) => {
    const result = getSectionAndLessonNumberFromPath(path);
    if (result === notFound) {
      return "A path which contains both a section and lesson number is required";
    }
    return true;
  })
);

const updateRepoSchema = Schema.Struct({
  filePath: Schema.String,
  // The lesson files that have been modified, i.e. moved from one path to another
  modifiedLessons: Schema.Record({
    key: lessonPathSchema,
    value: lessonPathSchema,
  }),
  // The lesson files that have been added, i.e. new files that have been added to the repo
  addedLessons: Schema.Array(lessonPathSchema),
  // The lesson files that have been deleted, i.e. files that have been removed from the repo
  deletedLessons: Schema.Array(lessonPathSchema),
});

const serializeSectionAndLesson = (sectionPath: string, lessonPath: string) => {
  return `${sectionPath}/${lessonPath}`;
};

export class UpdateRepoError extends Data.TaggedError("UpdateRepoError")<{
  cause: unknown;
}> {}

export class LessonNotFoundError extends Data.TaggedError(
  "LessonNotFoundError"
)<{
  lessonPath: string;
}> {}

const parseSectionAndLesson = (path: string) => {
  const pathParseResult = getSectionAndLessonNumberFromPath(path);

  if (pathParseResult === notFound) {
    return Effect.die(
      new UpdateRepoError({
        cause: `Invalid lesson path: ${path}`,
      })
    );
  }

  return Effect.succeed(pathParseResult);
};

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();
  return Effect.gen(function* () {
    const { filePath, modifiedLessons, addedLessons, deletedLessons } =
      yield* Schema.decodeUnknown(updateRepoSchema)(body);

    const db = yield* DBService;

    // Fetch the current repo, including all sections and lessons
    const repo = yield* db.getRepoWithSectionsByFilePath(filePath);

    const lessonPathToLesson = new Map<
      string,
      (typeof repo.sections)[number]["lessons"][number]
    >();

    const sectionPathToSectionId = new Map<string, string>();

    for (const section of repo.sections) {
      sectionPathToSectionId.set(section.path, section.id);
    }

    const getSectionOrCreate = Effect.fn("getSectionOrCreate")(function* (
      sectionPath: string,
      sectionNumber: number
    ) {
      const sectionId = sectionPathToSectionId.get(sectionPath);

      if (sectionId) {
        return sectionId;
      }

      const [section] = yield* db.createSections(repo.id, [
        { sectionPathWithNumber: sectionPath, sectionNumber },
      ]);

      sectionPathToSectionId.set(sectionPath, section!.id);

      return section!.id;
    });

    for (const section of repo.sections) {
      for (const lesson of section.lessons) {
        lessonPathToLesson.set(
          serializeSectionAndLesson(section.path, lesson.path),
          lesson
        );
      }
    }

    for (const lessonPath of Object.keys(modifiedLessons)) {
      const lesson = lessonPathToLesson.get(lessonPath);
      if (!lesson) {
        return yield* new LessonNotFoundError({
          lessonPath,
        });
      }
    }

    for (const lessonPath of deletedLessons) {
      const lesson = lessonPathToLesson.get(lessonPath);
      if (!lesson) {
        return yield* new LessonNotFoundError({
          lessonPath,
        });
      }

      if (lesson && lesson.videos && lesson.videos.length > 0) {
        // Throw an error and abort the update if a deleted lesson has an attached video
        return yield* new UpdateRepoError({
          cause: `Cannot delete lesson at path '${lessonPath}' because it has attached videos.`,
        });
      }
    }

    // 2. Handle modified lessons (moved/renamed):
    //    For each [oldPath, newPath] in modifiedLessons:
    //      - Find the lesson by oldPath
    //      - Update its path, section, and lesson number in the DB
    //      - Do NOT change the lesson's ID or attached videos, we'll handle that later

    for (const [lessonPath, newLessonPath] of Object.entries(modifiedLessons)) {
      const existingLessonPath = lessonPathToLesson.get(lessonPath)!;

      const pathParseResult = yield* parseSectionAndLesson(newLessonPath);

      const sectionId = yield* getSectionOrCreate(
        pathParseResult.sectionPathWithNumber,
        pathParseResult.sectionNumber
      );

      yield* db.updateLesson(existingLessonPath.id, {
        path: pathParseResult.lessonPathWithNumber,
        sectionId,
        lessonNumber: pathParseResult.lessonNumber,
      });
    }

    // 3. Handle added lessons:
    //    For each lessonPath in addedLessons:
    //      - If not already in the DB, create a new lesson entry
    //      - Assign it to the correct section (parse from path)
    //      - Create the section if it doesn't exist

    for (const lessonPath of addedLessons) {
      const pathParseResult = yield* parseSectionAndLesson(lessonPath);

      const sectionId = yield* getSectionOrCreate(
        pathParseResult.sectionPathWithNumber,
        pathParseResult.sectionNumber
      );

      const lesson = lessonPathToLesson.get(
        serializeSectionAndLesson(
          pathParseResult.sectionPathWithNumber,
          pathParseResult.lessonPathWithNumber
        )
      );

      // If the lesson already exists, skip it
      if (lesson) {
        continue;
      }

      yield* db.createLessons(sectionId, [
        {
          lessonPathWithNumber: pathParseResult.lessonPathWithNumber,
          lessonNumber: pathParseResult.lessonNumber,
        },
      ]);
    }

    // 4. Handle deleted lessons:
    //    For each lessonPath in deletedLessons:
    //      - Find the lesson by path
    //      - Delete or archive it in the DB (preserve video if needed)
    //      - If the section is now empty, consider deleting/archiving the section

    for (const lessonPath of deletedLessons) {
      const lesson = lessonPathToLesson.get(lessonPath)!;

      yield* db.deleteLesson(lesson.id);
    }

    // 5. After all updates, check for any sections that have no lessons left
    //    - Delete or archive empty sections as needed

    const repoAfterUpdates = yield* db.getRepoWithSectionsById(repo.id);

    const sectionsWithNoLessons = repoAfterUpdates.sections.filter(
      (section) => section.lessons.length === 0
    );

    for (const section of sectionsWithNoLessons) {
      yield* db.deleteSection(section.id);
    }

    return {
      success: true,
    };
  }).pipe(
    Effect.provide(layerLive),
    Effect.tapErrorCause((cause) => {
      return Console.error(cause);
    }),
    Effect.catchAll((e) => {
      return Effect.succeed(
        new Response("Internal server error", { status: 500 })
      );
    }),
    Effect.ensureErrorType<never>(),
    Effect.runPromise
  );
};
