import { ClipMockupOperationsService } from "@cvm/core/services/db-clip-mockup-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `clip-mockup` verb group: `cvm clip-mockup add | list | get | update |
 * move | delete`.
 *
 * Only the ROW half of each verb is here. The frame is a PNG on the author's
 * machine, so the CLI copies it in itself and sends this API nothing but the
 * path it chose, relative to the Clip Mockup directory.
 */
export const clipMockupRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/listClipMockupsByVideoId",
      forward(runtime, ClipMockupOperationsService, "listClipMockupsByVideoId")
    )
    .post(
      "/getClipMockupById",
      forward(runtime, ClipMockupOperationsService, "getClipMockupById")
    )
    .post(
      "/createClipMockup",
      forward(runtime, ClipMockupOperationsService, "createClipMockup")
    )
    .post(
      "/setClipMockupLine",
      forward(runtime, ClipMockupOperationsService, "setClipMockupLine")
    )
    .post(
      "/setClipMockupImagePath",
      forward(runtime, ClipMockupOperationsService, "setClipMockupImagePath")
    )
    .post(
      "/moveClipMockup",
      forward(runtime, ClipMockupOperationsService, "moveClipMockup")
    )
    .post(
      "/deleteClipMockup",
      forward(runtime, ClipMockupOperationsService, "deleteClipMockup")
    );
