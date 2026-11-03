import { Effect, Option } from "effect";
import { JOB_PARAMS } from "../job-params";
import { findExportedVideo } from "@/services/finished-videos.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import { uploadVideoToYouTube } from "@/services/youtube-upload-service";
import { PostingQueueSidecarService } from "@/services/db-posting-queue-sidecar.server";
import { definePostingJobKind } from "../job-kind";
import { reportPost } from "./post-events";
import { PostNotStartedError } from "./youtube";
import { checkYouTubePost } from "./youtube-post-check";

/**
 * The title and description a Short goes out with: the ones the modal's
 * post named, or — for a Posting Queue post — the Video's own, read now.
 */
const shortWords = (params: (typeof JOB_PARAMS)["youtube-shorts"]["Type"]) =>
  "postingQueueEntryId" in params
    ? Effect.flatMap(PostingQueueSidecarService, (queue) =>
        queue.shortToPost(params)
      )
    : Effect.succeed({ title: params.title, description: params.description });

export const shortUrl = (youtubeVideoId: string) =>
  `https://youtube.com/shorts/${youtubeVideoId}`;

/**
 * **YouTube Shorts post** (#3 in docs/plans/background-jobs-sidecar.md): the
 * rendered vertical Short, uploaded public without notifying subscribers,
 * and recorded as a `video_post` — the same steps the `post-youtube-shorts`
 * route ran. The Posting Queue enqueues it at a Posting Slot (ADR 0057). A POSTING kind (decision 5): one attempt, never re-queued, and
 * only the author's Retry runs it again.
 */
export const youtubeShortsJobKind = definePostingJobKind({
  params: JOB_PARAMS["youtube-shorts"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const storageRoots = yield* storageRootsConfig;
      const found = yield* findExportedVideo(
        storageRoots,
        `${params.videoId}.mp4`
      );
      if (Option.isNone(found)) {
        return yield* new PostNotStartedError({
          message: "Exported vertical video not found. Export it first.",
        });
      }
      const filePath = found.value;
      const { title, description } = yield* shortWords(params);
      const videoPosts = yield* VideoPostOperationsService;
      const post = yield* videoPosts.createVideoPost({
        videoId: params.videoId,
        platform: "youtube-shorts",
      });
      const accessToken = yield* getValidAccessToken;

      const reports = yield* reportPost(ctx);
      reports.onStage("uploading");
      const uploaded = yield* uploadVideoToYouTube({
        accessToken,
        filePath,
        title,
        description,
        privacyStatus: "public",
        notifySubscribers: false,
        onProgress: (percent) => reports.onProgress("uploading", percent),
      }).pipe(
        Effect.tap((result) =>
          Effect.sync(() =>
            reports.posted({
              youtubeVideoId: result.videoId,
              url: shortUrl(result.videoId),
            })
          )
        ),
        Effect.ensuring(reports.flush)
      );
      const remoteUrl = shortUrl(uploaded.videoId);
      yield* videoPosts.updateRemoteInfo({
        id: post.id,
        remoteId: uploaded.videoId,
        remoteUrl,
      });
      yield* videoPosts.markPosted(post.id);
      yield* Effect.logInfo("youtube-shorts: done", { remoteUrl });
    }),
  checkPosted: (params, post) =>
    Effect.flatMap(shortWords(params), ({ title }) =>
      checkYouTubePost({ title, post, linkTo: shortUrl })
    ),
});
