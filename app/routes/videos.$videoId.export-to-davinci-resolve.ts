import { Console, Effect } from "effect";
import type { Route } from "./+types/videos.$videoId.export-to-davinci-resolve";
import { DBService } from "@/services/db-service";
import { TotalTypeScriptCLIService } from "@/services/tt-cli-service";
import { layerLive } from "@/services/layer";
import { withDatabaseDump } from "@/services/dump-service";

export const action = async (args: Route.ActionArgs) => {
  return Effect.gen(function* () {
    const db = yield* DBService;
    const ttCli = yield* TotalTypeScriptCLIService;
    const { videoId } = args.params;

    const video = yield* db.getVideoWithClipsById(videoId, {
      withArchived: false,
    });

    const videoName = [
      video.lesson.section.path,
      video.lesson.path,
      video.path,
    ].join(" - ");

    const clips = video.clips;

    const output = yield* ttCli.sendClipsToDavinciResolve({
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
    Effect.tapErrorCause((e) => {
      return Console.log(e);
    }),
    Effect.provide(layerLive),
    Effect.runPromise
  );
};
