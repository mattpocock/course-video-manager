import { CoursePublishService } from "@/services/course-publish-service";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import {
  setYouTubeThumbnail,
  uploadVideoToYouTube,
} from "@/services/youtube-upload-service";
import { runtimeLive } from "@/services/layer.server";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import { Effect } from "effect";
import type { Route } from "./+types/api.videos.$videoId.upload";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;
  const body = await args.request.json();
  const title: string =
    typeof body.title === "string" ? body.title.trim() : body.title;
  const description: string =
    typeof body.description === "string"
      ? body.description.trim()
      : body.description;
  const privacyStatus: "public" | "unlisted" =
    body.privacyStatus === "public" ? "public" : "unlisted";
  const thumbnailId: string | undefined =
    typeof body.thumbnailId === "string" ? body.thumbnailId : undefined;

  if (!title || !description) {
    return Response.json(
      { error: "Title and description are required" },
      { status: 400 }
    );
  }

  if (!thumbnailId) {
    return Response.json(
      { error: "A thumbnail must be selected before uploading" },
      { status: 400 }
    );
  }

  const selectedThumbnail = await Effect.gen(function* () {
    const thumbnailOps = yield* ThumbnailOperationsService;
    return yield* thumbnailOps.getThumbnailById(thumbnailId);
  }).pipe(
    Effect.catchTag("NotFoundError", () => Effect.succeed(null)),
    runtimeLive.runPromise
  );

  if (!selectedThumbnail?.filePath || selectedThumbnail.videoId !== videoId) {
    return Response.json(
      { error: "A thumbnail must be selected before uploading" },
      { status: 400 }
    );
  }

  const thumbnailFilePath = selectedThumbnail.filePath;

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const publishService = yield* CoursePublishService;
        const filePath = yield* publishService.resolveExportPath(videoId);

        if (!filePath) {
          sendEvent("error", { message: "Video has not been exported" });
          return;
        }

        const accessToken = yield* getValidAccessToken;

        const result = yield* uploadVideoToYouTube({
          accessToken,
          filePath,
          title,
          description,
          privacyStatus,
          onProgress: (percentage) => {
            sendEvent("progress", { percentage });
          },
        });

        yield* setYouTubeThumbnail({
          accessToken,
          youtubeVideoId: result.videoId,
          thumbnailFilePath,
        });

        sendEvent("complete", { videoId: result.videoId });
      }),
    errorHandlers: [
      {
        tag: "NotAuthenticatedError",
        handler: (_, sendEvent) => {
          sendEvent("error", { message: "Not authenticated with YouTube" });
        },
      },
      {
        tag: "YouTubeUploadError",
        handler: (e, sendEvent) => {
          sendEvent("error", { message: e.message });
        },
      },
    ],
    fallbackMessage: "Upload failed unexpectedly",
  });
};
