import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { ConfigProvider, Console, Data, Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.update";
import {
  getSectionAndLessonNumberFromPath,
  notFound,
} from "@/services/course-repo-parser";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

class NotLatestVersionError extends Data.TaggedError("NotLatestVersionError")<{
  message: string;
}> {}

const lessonPathSchema = Schema.String.pipe(
  Schema.filter((path) => {
    const result = getSectionAndLessonNumberFromPath(path);
    if (result === notFound) {
      return "A path which contains both a section and lesson number is required";
    }
    return true;
  })
);

const updateCourseSchema = Schema.Struct({
  filePath: Schema.String,
  // The lesson files that have been modified, i.e. moved from one path to another
  modifiedLessons: Schema.Record({
    key: lessonPathSchema,
    value: lessonPathSchema,
  }),
  // The lesson files that have been added, i.e. new files that have been added to the course repo
  addedLessons: Schema.Array(lessonPathSchema),
  // The lesson files that have been deleted, i.e. files that have been removed from the course repo
  deletedLessons: Schema.Array(lessonPathSchema),
});

const serializeSectionAndLesson = (sectionPath: string, lessonPath: string) => {
  return `${sectionPath}/${lessonPath}`;
};

export class UpdateCourseError extends Data.TaggedError("UpdateCourseError")<{
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
      new UpdateCourseError({
        cause: `Invalid lesson path: ${path}`,
      })
    );
  }

  return Effect.succeed(pathParseResult);
};

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknown(updateCourseSchema)(body);

    const addedLessons = [...decoded.addedLessons];
    const deletedLessons = [...decoded.deletedLessons];
    const modifiedLessons = { ...decoded.modifiedLessons };

    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;
    const lessonSectionOps = yield* LessonSectionOperationsService;

    const baseCourse = yield* courseOps.getCourseByFilePath(decoded.filePath);

    // Get the latest version - updates should only affect latest version
    const latestVersion = yield* versionOps.getLatestCourseVersion(
      baseCourse.id
    );

    if (!latestVersion) {
      return yield* new NotLatestVersionError({
        message: `No version found for course at path '${decoded.filePath}'`,
      });
    }

    const courseWithSections = yield* versionOps.getCourseWithSectionsByVersion(
      {
        repoId: baseCourse.id,
        versionId: latestVersion.id,
      }
    );

    const lessonPathToLessonId = new Map<string, string>();

    const sectionPathToSectionId = new Map<string, string>();

    for (const section of courseWithSections.sections) {
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

      const [section] = yield* lessonSectionOps.createSections({
        sections: [{ sectionPathWithNumber: sectionPath, sectionNumber }],
        repoVersionId: latestVersion.id,
      });

      sectionPathToSectionId.set(sectionPath, section!.id);

      return section!.id;
    });

    for (const section of courseWithSections.sections) {
      for (const lesson of section.lessons) {
        // Skip ghost lessons — they don't exist on the filesystem
        // and shouldn't be matched against filesystem changes
        if (lesson.fsStatus === "ghost") continue;
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

      const lesson = yield* lessonSectionOps.getLessonById(lessonId);

      if (lesson && lesson.videos && lesson.videos.length > 0) {
        // Throw an error and abort the update if a deleted lesson has an attached video
        return yield* new UpdateCourseError({
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
          message: `Lesson in modifiedLessons not found in the course`,
        });
      }

      const newLessonPathParsed = yield* parseSectionAndLesson(newLessonPath);

      const sectionId = yield* getSectionOrCreate(
        newLessonPathParsed.sectionPathWithNumber,
        newLessonPathParsed.sectionNumber
      );

      yield* lessonSectionOps.updateLesson(existingLessonId, {
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

      const [newLesson] = yield* lessonSectionOps.createLessons(sectionId, [
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

      yield* lessonSectionOps.deleteLesson(lessonId);
    }

    // 5. After all updates, check for any sections that have no lessons left
    //    - Delete or archive empty sections as needed (only for the latest version)

    const courseAfterUpdates = yield* versionOps.getCourseWithSectionsByVersion(
      {
        repoId: courseWithSections.id,
        versionId: latestVersion.id,
      }
    );

    const sectionsWithNoLessons = courseAfterUpdates.sections.filter(
      (section) => section.lessons.length === 0
    );

    for (const section of sectionsWithNoLessons) {
      yield* lessonSectionOps.deleteSection(section.id);
    }

    return {
      success: true,
    };
  }).pipe(
    withDatabaseDump,
    Effect.withConfigProvider(ConfigProvider.fromEnv()),
    Effect.tapErrorCause((cause) => {
      return Console.error(cause);
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
