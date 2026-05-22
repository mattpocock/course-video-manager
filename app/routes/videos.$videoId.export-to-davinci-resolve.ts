import { Console, Effect } from "effect";
import type { Route } from "./+types/videos.$videoId.export-to-davinci-resolve";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const videoProcessing = yield* VideoProcessingService;
    const { videoId } = args.params;

    const video = yield* videoOps.getVideoWithClipsById(videoId, {
      withArchived: false,
    });

    const videoName = video.lesson
      ? [video.lesson.section.path, video.lesson.path, video.path].join(" - ")
      : video.path;

    const clips = video.clips;

    const output = yield* videoProcessing.sendClipsToDavinciResolve({
      clips: clips.map((clip) => ({
        inputVideo: clip.videoFilename,
        startTime: clip.sourceStartTime,
        duration: clip.sourceEndTime - clip.sourceStartTime,
      })),
      timelineName: videoName,
    });

    yield* Console.log(output);

    return {
      success: true,
    };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
