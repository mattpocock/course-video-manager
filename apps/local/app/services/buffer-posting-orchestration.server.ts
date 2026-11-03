import { Effect, Config, Option } from "effect";
import { findExportedVideo } from "@/services/finished-videos.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { BufferApiService } from "@/services/buffer-api-service.server";
import { ObjectStoreService } from "@/services/object-store-service.server";
import type { SendEvent } from "@/lib/create-sse-response.server";
import { SidecarContext } from "@/services/sidecar-context";

/**
 * Post a vertical Short to Buffer. It POSTS, so it runs only in the Sidecar
 * (`SidecarContext`), as a posting Job that runs once (decision 5 in
 * docs/plans/background-jobs-sidecar.md).
 */
export const bufferPostProgram = (opts: {
  videoId: string;
  caption: string;
  sendEvent: SendEvent;
}) =>
  Effect.gen(function* () {
    yield* SidecarContext;
    const storageRoots = yield* storageRootsConfig;
    const channelId = yield* Config.string("BUFFER_CHANNEL_ID");
    const videoPostOps = yield* VideoPostOperationsService;
    const bufferApi = yield* BufferApiService;
    const objectStore = yield* ObjectStoreService;

    const found = yield* findExportedVideo(storageRoots, `${opts.videoId}.mp4`);
    if (Option.isNone(found)) {
      opts.sendEvent("error", {
        message: "Exported vertical video not found. Export it first.",
      });
      return;
    }
    const filePath = found.value;

    // A dead key used to surface only after the whole video had uploaded.
    // Check it first, before any upload or row, so it fails in seconds.
    yield* bufferApi.verifyAuth();

    const post = yield* videoPostOps.createVideoPost({
      videoId: opts.videoId,
      platform: "buffer",
    });

    // Nothing reached Buffer (the S3 upload failed), or Buffer refused it:
    // nothing went out, so the row goes and a post check says not-posted.
    // Any other failure leaves the row: Buffer may have the post.
    const dropRow = videoPostOps
      .deleteUnpostedVideoPost(post.id)
      .pipe(Effect.orDie);

    opts.sendEvent("uploading-blob", { percentage: 0 });

    const objectKey = `cvm/buffer-posts/${opts.videoId}.mp4`;
    const uploaded = yield* objectStore
      .upload({
        pathname: objectKey,
        filePath,
        onProgress: (percentage) => {
          opts.sendEvent("uploading-blob", { percentage });
        },
      })
      .pipe(Effect.tapError(() => dropRow));

    opts.sendEvent("creating-post", {});

    const bufferPost = yield* bufferApi
      .createPost({
        channelId,
        text: opts.caption,
        videoUrl: uploaded.url,
      })
      .pipe(
        Effect.tapError((e) =>
          e._tag === "BufferAuthError" || e.refused ? dropRow : Effect.void
        )
      );

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
