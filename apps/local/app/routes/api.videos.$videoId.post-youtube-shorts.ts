import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import { uploadVideoToYouTube } from "@/services/youtube-upload-service";
import { runtimeLive } from "@/services/layer.server";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import { Effect, Config } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.videos.$videoId.post-youtube-shorts";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;
  const body = await args.request.json();
  const title: string = typeof body.title === "string" ? body.title.trim() : "";
  const description: string =
    typeof body.description === "string" ? body.description.trim() : "";

  if (!title || !description) {
    return Response.json(
      { error: "Title and description are required" },
      { status: 400 }
    );
  }

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const finishedDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");
        const fs = yield* FileSystem.FileSystem;
        const filePath = `${finishedDir}/${videoId}.mp4`;

        const exists = yield* fs.exists(filePath);
        if (!exists) {
          sendEvent("error", {
            message: "Exported vertical video not found. Export it first.",
          });
          return;
        }

        const videoPostOps = yield* VideoPostOperationsService;
        const post = yield* videoPostOps.createVideoPost({
          videoId,
          platform: "youtube-shorts",
        });

        sendEvent("stage", { stage: "uploading" });

        const accessToken = yield* getValidAccessToken;

        const result = yield* uploadVideoToYouTube({
          accessToken,
          filePath,
          title,
          description,
          privacyStatus: "public",
          notifySubscribers: false,
          onProgress: (percentage) => {
            sendEvent("progress", { percentage });
          },
        });

        const youtubeVideoId = result.videoId;
        const remoteUrl = `https://youtube.com/shorts/${youtubeVideoId}`;

        yield* videoPostOps.updateRemoteInfo({
          id: post.id,
          remoteId: youtubeVideoId,
          remoteUrl,
        });
        yield* videoPostOps.markPosted(post.id);

        sendEvent("complete", { youtubeVideoId, remoteUrl });
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
    fallbackMessage: "YouTube Shorts posting failed unexpectedly",
  });
};
