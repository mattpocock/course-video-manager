import { Data, Effect } from "effect";
import { JOB_PARAMS } from "../job-params";
import { CoursePublishService } from "@/services/course-publish-service";
import { loadUploadableThumbnail } from "@/services/youtube-thumbnail.server";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import {
  setYouTubeThumbnail,
  uploadVideoToYouTube,
} from "@/services/youtube-upload-service";
import { definePostingJobKind } from "../job-kind";
import { reportPost } from "./post-events";
import { checkYouTubePost } from "./youtube-post-check";

/** The post could not start: nothing was sent anywhere. */
export class PostNotStartedError extends Data.TaggedError(
  "PostNotStartedError"
)<{ readonly message: string }> {}

export const studioUrl = (youtubeVideoId: string) =>
  `https://studio.youtube.com/video/${youtubeVideoId}/edit`;

/**
 * **YouTube upload** (#1 in docs/plans/background-jobs-sidecar.md): the
 * Video's export, uploaded with its title, description and thumbnail —
 * the same `uploadVideoToYouTube` and `setYouTubeThumbnail` the `upload`
 * route used to run. A POSTING kind (decision 5): it runs once, a cut-off
 * run ends "interrupted — check before retrying", and only the author's
 * Retry runs it again. The browser's 3 attempts are gone on purpose.
 */
export const youtubeJobKind = definePostingJobKind({
  params: JOB_PARAMS["youtube"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      // The same check `cvm video post-youtube` makes before it queues:
      // this Video's own, rendered, not archived (youtube-thumbnail.server).
      const thumbnail = yield* loadUploadableThumbnail({
        thumbnailId: params.thumbnailId,
        videoId: params.videoId,
      }).pipe(
        Effect.catchTag(
          "ThumbnailNotUploadableError",
          () =>
            new PostNotStartedError({
              message: "A thumbnail must be selected before uploading",
            })
        )
      );
      const publish = yield* CoursePublishService;
      const filePath = yield* publish.resolveExportPath(params.videoId);
      if (!filePath) {
        return yield* new PostNotStartedError({
          message: "Video has not been exported",
        });
      }
      const accessToken = yield* getValidAccessToken;

      const reports = yield* reportPost(ctx);
      yield* Effect.logInfo("youtube: uploading", { filePath });
      const result = yield* Effect.gen(function* () {
        const uploaded = yield* uploadVideoToYouTube({
          accessToken,
          filePath,
          title: params.title,
          description: params.description,
          privacyStatus: params.privacyStatus,
          notifySubscribers: true,
          onProgress: (percent) => reports.onProgress("uploading", percent),
        });
        // The Video exists on YouTube from here: say so before the
        // thumbnail, so a failure after this still names it.
        reports.posted({
          youtubeVideoId: uploaded.videoId,
          url: studioUrl(uploaded.videoId),
        });
        yield* setYouTubeThumbnail({
          accessToken,
          youtubeVideoId: uploaded.videoId,
          // On whichever Storage Root has it (ADR 0040).
          thumbnailFilePath: thumbnail.path,
        });
        return uploaded;
      }).pipe(Effect.ensuring(reports.flush));
      yield* Effect.logInfo("youtube: done", {
        youtubeVideoId: result.videoId,
      });
    }),
  checkPosted: (params, post) =>
    checkYouTubePost({ title: params.title, post, linkTo: studioUrl }),
});
