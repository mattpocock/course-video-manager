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
 * `create`/`rename`/`move`/`archive` all stay on LessonSectionOperationsService
 * primitives (createSections / updateSectionTitle / batchUpdateSectionOrders /
 * archiveSection) rather than CourseWriteService — the CLI command layer does
 * its own order math, the same way `cvm lesson create`/`archive` do. See
 * apps/local/app/cli/commands/section.ts.
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
    );
