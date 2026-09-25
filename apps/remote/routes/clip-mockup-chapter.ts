import { ClipMockupChapterOperationsService } from "@cvm/core/services/db-clip-mockup-chapter-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `clip-mockup-chapter` verb group: `cvm clip-mockup-chapter add | list |
 * get | update | move | delete`.
 *
 * NOT LOCAL-ONLY, unlike `clip-mockup` beside it. Every verb here is a row and
 * touches no disk, so it works from any box with a token — the asymmetry is
 * deliberate and is stated in the CLI's help.
 *
 * `listAnimaticOrder` is the one merged read of a Video's Animatic, both kinds
 * of row in one ordered list. It is exposed here because the CLI's
 * `--before`/`--after` resolver runs in `apps/local` and needs the same list the
 * positioning writes use.
 */
export const clipMockupChapterRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/listAnimaticOrder",
      forward(runtime, ClipMockupChapterOperationsService, "listAnimaticOrder")
    )
    .post(
      "/listClipMockupChaptersByVideoId",
      forward(
        runtime,
        ClipMockupChapterOperationsService,
        "listClipMockupChaptersByVideoId"
      )
    )
    .post(
      "/getClipMockupChaptersByIds",
      forward(
        runtime,
        ClipMockupChapterOperationsService,
        "getClipMockupChaptersByIds"
      )
    )
    .post(
      "/getClipMockupChapterById",
      forward(
        runtime,
        ClipMockupChapterOperationsService,
        "getClipMockupChapterById"
      )
    )
    .post(
      "/createClipMockupChapterAtItem",
      forward(
        runtime,
        ClipMockupChapterOperationsService,
        "createClipMockupChapterAtItem"
      )
    )
    .post(
      "/updateClipMockupChapter",
      forward(
        runtime,
        ClipMockupChapterOperationsService,
        "updateClipMockupChapter"
      )
    )
    .post(
      "/moveClipMockupChapterToPosition",
      forward(
        runtime,
        ClipMockupChapterOperationsService,
        "moveClipMockupChapterToPosition"
      )
    )
    .post(
      "/archiveClipMockupChapter",
      forward(
        runtime,
        ClipMockupChapterOperationsService,
        "archiveClipMockupChapter"
      )
    );
