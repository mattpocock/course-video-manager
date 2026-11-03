import type { PostingQueueOperationsService } from "@/services/db-posting-queue-operations.server";
import { rpcMethod, type RemoteService, type RpcClient } from "./rpc-client";

/** The Posting Queue verbs of `cvm short`, over HTTP. See ./rpc-layer.ts. */
export const postingQueueService = (client: RpcClient) =>
  ({
    _tag: "PostingQueueOperationsService",
    postShorts: rpcMethod((json) =>
      client.rpc.short.postShorts.$post({ json })
    ),
    listPostingQueue: rpcMethod((json) =>
      client.rpc.short.listPostingQueue.$post({ json })
    ),
  }) satisfies RemoteService<PostingQueueOperationsService>;
