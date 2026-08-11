import { VersionOperationsService } from "@cvm/core/services/db-version-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `version` verb group: `cvm version list | get | tree`, plus the Draft
 * resolution every version-scoped read in the CLI does first.
 */
export const versionRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/getCourseVersions",
      forward(runtime, VersionOperationsService, "getCourseVersions")
    )
    .post(
      "/getCourseVersionById",
      forward(runtime, VersionOperationsService, "getCourseVersionById")
    )
    .post(
      "/getLatestCourseVersion",
      forward(runtime, VersionOperationsService, "getLatestCourseVersion")
    )
    .post(
      "/getVersionWithSections",
      forward(runtime, VersionOperationsService, "getVersionWithSections")
    );
