import { CourseOperationsService } from "@cvm/core/services/db-course-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `course` verb group: `cvm course list | get | tree | transcripts`.
 *
 * One route per method the CLI calls, and nothing else — the API's surface is
 * exactly what `cvm` asks for, so nothing here can be reached that no command
 * uses.
 */
export const courseRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/getCourses",
      forward(runtime, CourseOperationsService, "getCourses")
    )
    .post(
      "/getArchivedCourses",
      forward(runtime, CourseOperationsService, "getArchivedCourses")
    )
    .post(
      "/getCourseById",
      forward(runtime, CourseOperationsService, "getCourseById")
    )
    .post(
      "/getCourseWithSlimClipsById",
      forward(runtime, CourseOperationsService, "getCourseWithSlimClipsById")
    )
    .post(
      "/getVideoTranscripts",
      forward(runtime, CourseOperationsService, "getVideoTranscripts")
    );
