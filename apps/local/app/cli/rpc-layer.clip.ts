import type { ClipOperationsService } from "@/services/db-clip-operations.server";
import { rpcMethod, type RemoteService, type RpcClient } from "./rpc-client";

/**
 * The `clip` (and `chapter`) verb groups' RPC-backed service, split out of
 * rpc-layer.ts to keep that file under the repo's per-file token budget. Same
 * contract as every service there: one `rpcMethod` line per endpoint, checked
 * against the service's own signature by `satisfies`.
 */
export const clipService = (client: RpcClient) =>
  ({
    _tag: "ClipOperationsService",
    getClipsByIds: rpcMethod((json) =>
      client.rpc.clip.getClipsByIds.$post({ json })
    ),
    listTimelineOrder: rpcMethod((json) =>
      client.rpc.clip.listTimelineOrder.$post({ json })
    ),
    createClip: rpcMethod((json) => client.rpc.clip.createClip.$post({ json })),
    updateClip: rpcMethod((json) => client.rpc.clip.updateClip.$post({ json })),
    retimeClip: rpcMethod((json) => client.rpc.clip.retimeClip.$post({ json })),
    setClipZoom: rpcMethod((json) =>
      client.rpc.clip.setClipZoom.$post({ json })
    ),
    moveClipToPosition: rpcMethod((json) =>
      client.rpc.clip.moveClipToPosition.$post({ json })
    ),
    moveClipToVideo: rpcMethod((json) =>
      client.rpc.clip.moveClipToVideo.$post({ json })
    ),
    archiveClip: rpcMethod((json) =>
      client.rpc.clip.archiveClip.$post({ json })
    ),
    restoreClip: rpcMethod((json) =>
      client.rpc.clip.restoreClip.$post({ json })
    ),
    listTranscriptWords: rpcMethod((json) =>
      client.rpc.clip.listTranscriptWords.$post({ json })
    ),
    replaceTranscriptWords: rpcMethod((json) =>
      client.rpc.clip.replaceTranscriptWords.$post({ json })
    ),
    listClipLayers: rpcMethod((json) =>
      client.rpc.clip.listClipLayers.$post({ json })
    ),
    setClipLayers: rpcMethod((json) =>
      client.rpc.clip.setClipLayers.$post({ json })
    ),
    // Chapters live on this same service (ClipOperationsService merges the
    // chapter ops in), so `cvm chapter`'s verbs are RPC methods here too, backed
    // by the /rpc/chapter route group.
    getChaptersByIds: rpcMethod((json) =>
      client.rpc.chapter.getChaptersByIds.$post({ json })
    ),
    listChaptersByVideoId: rpcMethod((json) =>
      client.rpc.chapter.listChaptersByVideoId.$post({ json })
    ),
    createChapterAtItem: rpcMethod((json) =>
      client.rpc.chapter.createChapterAtItem.$post({ json })
    ),
    updateChapter: rpcMethod((json) =>
      client.rpc.chapter.updateChapter.$post({ json })
    ),
    moveChapterToPosition: rpcMethod((json) =>
      client.rpc.chapter.moveChapterToPosition.$post({ json })
    ),
    archiveChapter: rpcMethod((json) =>
      client.rpc.chapter.archiveChapter.$post({ json })
    ),
  }) satisfies RemoteService<ClipOperationsService>;
