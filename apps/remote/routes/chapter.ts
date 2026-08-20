import { ClipOperationsService } from "@cvm/core/services/db-clip-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `chapter` verb group: `cvm chapter list | get | add | update | move |
 * delete`.
 *
 * Chapters live on the SAME service as Clips (ClipOperationsService merges the
 * chapter ops in), because Clips and Chapters share one fractional order space —
 * so `add`/`move` position against the merged clip+chapter timeline the CLI
 * reads through `clip.listTimelineOrder`. These endpoints just expose the
 * chapter methods already on that service; the DB logic is unchanged.
 */
export const chapterRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/getChaptersByIds",
      forward(runtime, ClipOperationsService, "getChaptersByIds")
    )
    .post(
      "/listChaptersByVideoId",
      forward(runtime, ClipOperationsService, "listChaptersByVideoId")
    )
    .post(
      "/createChapterAtItem",
      forward(runtime, ClipOperationsService, "createChapterAtItem")
    )
    .post(
      "/updateChapter",
      forward(runtime, ClipOperationsService, "updateChapter")
    )
    .post(
      "/moveChapterToPosition",
      forward(runtime, ClipOperationsService, "moveChapterToPosition")
    )
    .post(
      "/archiveChapter",
      forward(runtime, ClipOperationsService, "archiveChapter")
    );
