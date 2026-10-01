import { CourseWriteService } from "@cvm/core/services/course-write-service";
import { LessonSectionOperationsService } from "@cvm/core/services/db-lesson-section-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `lesson` verb group: `cvm lesson list | get | tree | create | update |
 * move`.
 *
 * `moveToSection` is the one route here backed by CourseWriteService rather
 * than the operations service: re-sectioning a Lesson renumbers both
 * Sections, and that logic lives with the writes. A within-Section `move` is
 * plain `batchUpdateLessonOrders`.
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
      "/deleteLesson",
      forward(runtime, LessonSectionOperationsService, "deleteLesson")
    )
    .post(
      "/moveToSection",
      forward(runtime, CourseWriteService, "moveToSection")
    );
