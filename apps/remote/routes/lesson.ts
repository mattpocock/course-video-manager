import { CourseWriteService } from "@cvm/core/services/course-write-service";
import { LessonSectionOperationsService } from "@cvm/core/services/db-lesson-section-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `lesson` verb group: `cvm lesson list | get | tree | create | update |
 * move`.
 *
 * `move` is the one verb here backed by CourseWriteService rather than the
 * operations service: reordering and re-sectioning a Lesson renumbers paths
 * across the Version, and that projection lives with the writes.
 */
export const lessonRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/getLessonsBySectionId",
      forward(runtime, LessonSectionOperationsService, "getLessonsBySectionId")
    )
    .post(
      "/getLessonById",
      forward(runtime, LessonSectionOperationsService, "getLessonById")
    )
    .post(
      "/getLessonWithHierarchyById",
      forward(
        runtime,
        LessonSectionOperationsService,
        "getLessonWithHierarchyById"
      )
    )
    .post(
      "/createLesson",
      forward(runtime, LessonSectionOperationsService, "createLesson")
    )
    .post(
      "/updateLesson",
      forward(runtime, LessonSectionOperationsService, "updateLesson")
    )
    .post(
      "/batchUpdateLessonOrders",
      forward(
        runtime,
        LessonSectionOperationsService,
        "batchUpdateLessonOrders"
      )
    )
    .post(
      "/reorderLessons",
      forward(runtime, CourseWriteService, "reorderLessons")
    )
    .post(
      "/moveToSection",
      forward(runtime, CourseWriteService, "moveToSection")
    );
