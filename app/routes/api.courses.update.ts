import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { ConfigProvider, Data, Effect, Schema } from "effect";
import {
  getSectionAndLessonNumberFromPath,
  notFound,
} from "@/services/course-repo-parser";
import { makeAction } from "@/services/route-action.server";

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
  modifiedLessons: Schema.Record({
    key: lessonPathSchema,
    value: lessonPathSchema,
  }),
  addedLessons: Schema.Array(lessonPathSchema),
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

export const action = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(updateCourseSchema)(payload);

      const addedLessons = [...decoded.addedLessons];
      const deletedLessons = [...decoded.deletedLessons];
      const modifiedLessons = { ...decoded.modifiedLessons };

      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const baseCourse = yield* courseOps.getCourseByFilePath(decoded.filePath);

      const latestVersion = yield* versionOps.getLatestCourseVersion(
        baseCourse.id
      );

      if (!latestVersion) {
        return yield* new NotLatestVersionError({
          message: `No version found for course at path '${decoded.filePath}'`,
        });
      }

      const courseWithSections =
        yield* versionOps.getCourseWithSectionsByVersion({
          repoId: baseCourse.id,
          versionId: latestVersion.id,
        });

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
          if (lesson.fsStatus === "ghost") continue;
          lessonPathToLessonId.set(
            serializeSectionAndLesson(section.path, lesson.path),
            lesson.id
          );
        }
      }

      for (const [lessonPath, newLessonPath] of Object.entries(
        modifiedLessons
      )) {
        const lessonId = lessonPathToLessonId.get(lessonPath);
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
          return yield* new UpdateCourseError({
            cause: `Cannot delete lesson at path '${lessonPath}' because it has attached videos.`,
          });
        }
      }

      for (const [lessonPath, newLessonPath] of Object.entries(
        modifiedLessons
      )) {
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

      for (const lessonPath of deletedLessons) {
        const lessonId = lessonPathToLessonId.get(lessonPath);
        if (!lessonId) {
          continue;
        }

        yield* lessonSectionOps.deleteLesson(lessonId);
      }

      const courseAfterUpdates =
        yield* versionOps.getCourseWithSectionsByVersion({
          repoId: courseWithSections.id,
          versionId: latestVersion.id,
        });

      const sectionsWithNoLessons = courseAfterUpdates.sections.filter(
        (section) => section.lessons.length === 0
      );

      for (const section of sectionsWithNoLessons) {
        yield* lessonSectionOps.deleteSection(section.id);
      }

      return {
        success: true,
      };
    }).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv())),
});
