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
  message: string;
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
    const decoded = yield* Schema.decodeUnknown(updateRepoSchema)(body);

    const addedLessons = [...decoded.addedLessons];
    const deletedLessons = [...decoded.deletedLessons];
    const modifiedLessons = { ...decoded.modifiedLessons };

    const db = yield* DBService;

    // Fetch the current repo, including all sections and lessons
    const repo = yield* db.getRepoWithSectionsByFilePath(decoded.filePath);

    const lessonPathToLessonId = new Map<string, string>();

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
        lessonPathToLessonId.set(
          serializeSectionAndLesson(section.path, lesson.path),
          lesson.id
        );
      }
    }

    for (const [lessonPath, newLessonPath] of Object.entries(modifiedLessons)) {
      const lessonId = lessonPathToLessonId.get(lessonPath);
      // If the lesson is not found, it has been moved to a new path
      // so we need to add it to the added lessons
      if (!lessonId) {
        addedLessons.push(newLessonPath);
        delete modifiedLessons[lessonPath];
      }
    }

    for (const lessonPath of deletedLessons) {
      const lessonId = lessonPathToLessonId.get(lessonPath);
      if (!lessonId) {
        continue;
      }

      const lesson = yield* db.getLessonById(lessonId);

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
      const existingLessonId = lessonPathToLessonId.get(lessonPath);
      if (!existingLessonId) {
        return yield* new LessonNotFoundError({
          lessonPath,
          message: `Lesson in modifiedLessons not found in the repo`,
        });
      }

      const newLessonPathParsed = yield* parseSectionAndLesson(newLessonPath);

      const sectionId = yield* getSectionOrCreate(
        newLessonPathParsed.sectionPathWithNumber,
        newLessonPathParsed.sectionNumber
      );

      yield* db.updateLesson(existingLessonId, {
        path: newLessonPathParsed.lessonPathWithNumber,
        sectionId,
        lessonNumber: newLessonPathParsed.lessonNumber,
      });

      lessonPathToLessonId.delete(lessonPath);
      lessonPathToLessonId.set(
        serializeSectionAndLesson(
          newLessonPathParsed.sectionPathWithNumber,
          newLessonPathParsed.lessonPathWithNumber
        ),
        existingLessonId
      );
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

      const lessonId = lessonPathToLessonId.get(
        serializeSectionAndLesson(
          pathParseResult.sectionPathWithNumber,
          pathParseResult.lessonPathWithNumber
        )
      );

      // If the lesson already exists, skip it
      if (lessonId) {
        continue;
      }

      const [newLesson] = yield* db.createLessons(sectionId, [
        {
          lessonPathWithNumber: pathParseResult.lessonPathWithNumber,
          lessonNumber: pathParseResult.lessonNumber,
        },
      ]);

      lessonPathToLessonId.set(
        serializeSectionAndLesson(
          pathParseResult.sectionPathWithNumber,
          pathParseResult.lessonPathWithNumber
        ),
        newLesson!.id
      );
    }

    // 4. Handle deleted lessons:
    //    For each lessonPath in deletedLessons:
    //      - Find the lesson by path
    //      - Delete or archive it in the DB (preserve video if needed)
    //      - If the section is now empty, consider deleting/archiving the section

    for (const lessonPath of deletedLessons) {
      const lessonId = lessonPathToLessonId.get(lessonPath);
      if (!lessonId) {
        // It has already been deleted or moved, so ignore
        continue;
      }

      yield* db.deleteLesson(lessonId);
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
