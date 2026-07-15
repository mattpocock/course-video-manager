import { Effect, Config } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { BufferApiService } from "@/services/buffer-api-service.server";
import { VercelBlobService } from "@/services/vercel-blob-service.server";
import type { SendEvent } from "@/lib/create-sse-response.server";

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export const bufferPostProgram = (opts: {
  videoId: string;
  caption: string;
  sendEvent: SendEvent;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}) =>
  Effect.gen(function* () {
    const finishedDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");
    const channelId = yield* Config.string("BUFFER_CHANNEL_ID");
    const fs = yield* FileSystem.FileSystem;
    const videoPostOps = yield* VideoPostOperationsService;
    const bufferApi = yield* BufferApiService;
    const blobService = yield* VercelBlobService;

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

    const blobPathname = `buffer-posts/${opts.videoId}.mp4`;
    const blob = yield* blobService.upload({
      pathname: blobPathname,
      filePath,
      onProgress: (percentage) => {
        opts.sendEvent("uploading-blob", { percentage });
      },
    });

    opts.sendEvent("creating-post", {});

    const bufferPost = yield* bufferApi.createPost({
      channelId,
      text: opts.caption,
      videoUrl: blob.url,
    });

    yield* videoPostOps.updateRemoteInfo({
      id: post.id,
      remoteId: bufferPost.id,
      remoteUrl: null,
    });

    opts.sendEvent("polling", { status: "buffer" });

    const pollInterval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const pollTimeout = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > pollTimeout) {
        opts.sendEvent("error", {
          message:
            "Buffer post timed out waiting for delivery. The blob has been kept for retry.",
        });
        return;
      }

      yield* Effect.sleep(pollInterval);

      const result = yield* bufferApi.getPostStatus(bufferPost.id);

      opts.sendEvent("polling", { status: result.status });

      if (result.status === "sent") {
        opts.sendEvent("cleaning-up", {});

        yield* blobService.del(blob.url);
        yield* videoPostOps.markPosted(post.id);

        opts.sendEvent("complete", {});
        return;
      }

      if (result.status === "error") {
        opts.sendEvent("error", {
          message:
            "Buffer reported an error posting. The blob has been kept for retry.",
        });
        return;
      }
    }
  });
