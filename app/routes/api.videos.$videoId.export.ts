import { Console, Effect, Schema } from "effect";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import type { Route } from "./+types/api.videos.$videoId.export";
import { TotalTypeScriptCLIService } from "@/services/tt-cli-service";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;

  return Effect.gen(function* () {
    const db = yield* DBService;
    const ttCliService = yield* TotalTypeScriptCLIService;

    const video = yield* db.getVideoWithClipsById(videoId);

    const clips = video.clips;

    const result = yield* ttCliService.exportVideoClips(
      videoId,
      clips.map((clip) => ({
        inputVideo: clip.videoFilename,
        startTime: clip.sourceStartTime,
        duration: clip.sourceEndTime - clip.sourceStartTime,
      }))
    );

    yield* Console.log(result);

    return { success: true };
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};
