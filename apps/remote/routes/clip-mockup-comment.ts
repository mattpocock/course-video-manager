import { ClipMockupCommentOperationsService } from "@cvm/core/services/db-clip-mockup-comment-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `clip-mockup-comment` verb group: `cvm clip-mockup-comment add | list |
 * get | update | delete`.
 *
 * NOT LOCAL-ONLY, like `clip-mockup-chapter`: a comment is a row and touches no
 * disk, so an agent on any box can read the author's notes for a Video.
 */
export const clipMockupCommentRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/listClipMockupCommentsByVideoId",
      forward(
        runtime,
        ClipMockupCommentOperationsService,
        "listClipMockupCommentsByVideoId"
      )
    )
    .post(
      "/getClipMockupCommentById",
      forward(
        runtime,
        ClipMockupCommentOperationsService,
        "getClipMockupCommentById"
      )
    )
    .post(
      "/createClipMockupComment",
      forward(
        runtime,
        ClipMockupCommentOperationsService,
        "createClipMockupComment"
      )
    )
    .post(
      "/updateClipMockupComment",
      forward(
        runtime,
        ClipMockupCommentOperationsService,
        "updateClipMockupComment"
      )
    )
    .post(
      "/deleteClipMockupComment",
      forward(
        runtime,
        ClipMockupCommentOperationsService,
        "deleteClipMockupComment"
      )
    );
