import { LessonSectionOperationsService } from "@cvm/core/services/db-lesson-section-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `section` verb group: `cvm section list | get | tree`.
 *
 * Sections and Lessons share one operations service, but they are two nouns to
 * an agent, so they are two groups here.
 */
export const sectionRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/getSectionsByRepoVersionId",
      forward(
        runtime,
        LessonSectionOperationsService,
        "getSectionsByRepoVersionId"
      )
    )
    .post(
      "/getSectionWithHierarchyById",
      forward(
        runtime,
        LessonSectionOperationsService,
        "getSectionWithHierarchyById"
      )
    );
