import { ClipOperationsService } from "@cvm/core/services/db-clip-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `clip` verb group: `cvm clip list | get | add | update | move | delete |
 * words`.
 *
 * `listTimelineOrder` is what `move` and `add` position against — Clips and
 * Chapters share one fractional order key, so the anchor an agent names may be
 * either.
 */
export const clipRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/getClipsByIds",
      forward(runtime, ClipOperationsService, "getClipsByIds")
    )
    .post("/createClip", forward(runtime, ClipOperationsService, "createClip"))
    .post(
      "/listTimelineOrder",
      forward(runtime, ClipOperationsService, "listTimelineOrder")
    )
    .post("/updateClip", forward(runtime, ClipOperationsService, "updateClip"))
    .post(
      "/setClipZoom",
      forward(runtime, ClipOperationsService, "setClipZoom")
    )
    .post(
      "/moveClipToPosition",
      forward(runtime, ClipOperationsService, "moveClipToPosition")
    )
    .post(
      "/archiveClip",
      forward(runtime, ClipOperationsService, "archiveClip")
    )
    .post(
      "/listTranscriptWords",
      forward(runtime, ClipOperationsService, "listTranscriptWords")
    )
    .post(
      "/replaceTranscriptWords",
      forward(runtime, ClipOperationsService, "replaceTranscriptWords")
    );
