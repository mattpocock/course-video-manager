import { OverlayOperationsService } from "@cvm/core/services/db-overlay-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `overlay` verb group: `cvm overlay list | get | add | update | delete`.
 *
 * Every verb is here rather than behind a local-machine gate on purpose — an
 * Overlay is pure domain data (a Clip id, an offset, a duration and the
 * Definition Card's text), so authoring one needs the database and nothing
 * else. Only the export/render step that consumes them stays local-only.
 */
export const overlayRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/listOverlaysByVideoId",
      forward(runtime, OverlayOperationsService, "listOverlaysByVideoId")
    )
    .post(
      "/getOverlaysByIds",
      forward(runtime, OverlayOperationsService, "getOverlaysByIds")
    )
    .post(
      "/createOverlay",
      forward(runtime, OverlayOperationsService, "createOverlay")
    )
    .post(
      "/updateOverlay",
      forward(runtime, OverlayOperationsService, "updateOverlay")
    )
    .post(
      "/deleteOverlay",
      forward(runtime, OverlayOperationsService, "deleteOverlay")
    );
