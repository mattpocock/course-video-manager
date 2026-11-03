import { PostingQueueOperationsService } from "@cvm/core/services/db-posting-queue-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `short` verb group's Posting Queue verbs: `cvm short post` adds Shorts
 * to the Posting Queue, `cvm short queue` lists when each goes out,
 * `cvm short move` and `cvm short unqueue` change it.
 */
export const shortRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/postShorts",
      forward(runtime, PostingQueueOperationsService, "postShorts")
    )
    .post(
      "/listPostingQueue",
      forward(runtime, PostingQueueOperationsService, "listPostingQueue")
    )
    .post(
      "/moveShort",
      forward(runtime, PostingQueueOperationsService, "moveShort")
    )
    .post(
      "/unqueueShorts",
      forward(runtime, PostingQueueOperationsService, "unqueueShorts")
    );
