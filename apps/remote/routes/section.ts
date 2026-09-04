import { CourseWriteService } from "@cvm/core/services/course-write-service";
import { LessonSectionOperationsService } from "@cvm/core/services/db-lesson-section-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `section` verb group: `cvm section list | get | tree | create | rename |
 * move | archive`.
 *
 * Sections and Lessons share one operations service, but they are two nouns to
 * an agent, so they are two groups here.
 *
 * `create`/`rename`/`archive` stay on LessonSectionOperationsService primitives
 * (createSections / updateSectionTitle / archiveSection / batchUpdateSectionOrders
 * — the last one also shifts siblings for `create`'s --before/--after anchor) —
 * the CLI command layer does its own order math for `create`, the same way
 * `cvm lesson create`/`archive` do. `move` is backed by CourseWriteService
 * instead, same as `cvm lesson move`'s within-section reorder: reordering
 * renumbers paths across the Version, and that projection lives with the
 * writes. See apps/local/app/cli/commands/section.ts.
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
    )
    .post(
      "/createSections",
      forward(runtime, LessonSectionOperationsService, "createSections")
    )
    .post(
      "/updateSectionTitle",
      forward(runtime, LessonSectionOperationsService, "updateSectionTitle")
    )
    .post(
      "/archiveSection",
      forward(runtime, LessonSectionOperationsService, "archiveSection")
    )
    .post(
      "/batchUpdateSectionOrders",
      forward(
        runtime,
        LessonSectionOperationsService,
        "batchUpdateSectionOrders"
      )
    )
    .post(
      "/reorderSections",
      forward(runtime, CourseWriteService, "reorderSections")
    );
