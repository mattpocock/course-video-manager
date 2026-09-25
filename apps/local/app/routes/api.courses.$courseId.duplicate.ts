import { Effect, Schema } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { copyClipMockupAssetsForVideos } from "@/services/clip-mockup-copy-forward.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

const duplicateCourseSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Course name cannot be empty" })
  ),
});

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404, InvalidClipMockupPathError: 400 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(duplicateCourseSchema)(
        payload
      );

      const name = parsed.name.trim();

      const courseOps = yield* CourseOperationsService;

      const sourceCourse = yield* courseOps.getCourseById(params.courseId!);

      if (name === sourceCourse.name) {
        return yield* Effect.die(
          data(
            { error: "New course name must differ from the original" },
            { status: 400 }
          )
        );
      }

      const allCourses = yield* courseOps.getCourses();
      const archivedCourses = yield* courseOps.getArchivedCourses();
      const allCoursesCombined = [...allCourses, ...archivedCourses];

      if (allCoursesCombined.some((c) => c.name === name)) {
        return yield* Effect.die(
          data(
            { error: "A course with this name already exists" },
            { status: 400 }
          )
        );
      }

      const result = yield* courseOps.duplicateCourse({
        sourceCourseId: params.courseId!,
        name,
      });

      // Same as the single-Video duplicate: every duplicated Video got a
      // fresh `lineageId`, so its Clip Mockups' frames and WAVs have to be
      // carried into the new directory here (#1669).
      yield* copyClipMockupAssetsForVideos(result.videoLineageMappings);

      return { id: result.course.id };
    }),
});
