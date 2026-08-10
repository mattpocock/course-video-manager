import { Effect, Config } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { BufferApiService } from "@/services/buffer-api-service.server";
import { ObjectStoreService } from "@/services/object-store-service.server";
import type { SendEvent } from "@/lib/create-sse-response.server";

export const bufferPostProgram = (opts: {
  videoId: string;
  caption: string;
  sendEvent: SendEvent;
}) =>
  Effect.gen(function* () {
    const finishedDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");
    const channelId = yield* Config.string("BUFFER_CHANNEL_ID");
    const fs = yield* FileSystem.FileSystem;
    const videoPostOps = yield* VideoPostOperationsService;
    const bufferApi = yield* BufferApiService;
    const objectStore = yield* ObjectStoreService;

    const filePath = `${finishedDir}/${opts.videoId}.mp4`;
    const exists = yield* fs.exists(filePath);
    if (!exists) {
      opts.sendEvent("error", {
        message: "Exported vertical video not found. Export it first.",
      });
      return;
    }

    const post = yield* videoPostOps.createVideoPost({
      videoId: opts.videoId,
      platform: "buffer",
    });

    opts.sendEvent("uploading-blob", { percentage: 0 });

    const objectKey = `cvm/buffer-posts/${opts.videoId}.mp4`;
    const uploaded = yield* objectStore.upload({
      pathname: objectKey,
      filePath,
      onProgress: (percentage) => {
        opts.sendEvent("uploading-blob", { percentage });
      },
    });

    opts.sendEvent("creating-post", {});

    const bufferPost = yield* bufferApi.createPost({
      channelId,
      text: opts.caption,
      videoUrl: uploaded.url,
    });

    yield* videoPostOps.updateRemoteInfo({
      id: post.id,
      remoteId: bufferPost.id,
      remoteUrl: null,
    });

    // "Posted" now means "submitted to Buffer" — Buffer downloads the freshly
    // uploaded object asynchronously. The object is cleaned up by an S3
    // lifecycle rule (1-day expiry on cvm/buffer-posts/), not by app code, so
    // we mark the post as posted immediately and do not delete anything here.
    yield* videoPostOps.markPosted(post.id);

    opts.sendEvent("complete", {});
  });
