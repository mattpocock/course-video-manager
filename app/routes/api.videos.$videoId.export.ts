import { Console, Effect, Schema } from "effect";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import type { Route } from "./+types/api.videos.$videoId.export";
import { TotalTypeScriptCLIService } from "@/services/tt-cli-service";
import { FINAL_VIDEO_PADDING } from "@/features/video-editor/constants";
import { withDatabaseDump } from "@/services/dump-service";

const exportVideoSchema = Schema.Struct({
  shortsDirectoryOutputName: Schema.optional(Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  const { videoId } = args.params;

  return Effect.gen(function* () {
    const db = yield* DBService;
    const ttCliService = yield* TotalTypeScriptCLIService;

    const { shortsDirectoryOutputName } = yield* Schema.decodeUnknown(
      exportVideoSchema
    )(formDataObject);

    const video = yield* db.getVideoWithClipsById(videoId);

    const clips = video.clips;

    const result = yield* ttCliService.exportVideoClips({
      shortsDirectoryOutputName,
      videoId: videoId,
      clips: clips.map((clip, index, array) => {
        const isFinalClip = index === array.length - 1;
        return {
          inputVideo: clip.videoFilename,
          startTime: clip.sourceStartTime,
          duration:
            clip.sourceEndTime -
            clip.sourceStartTime +
            (isFinalClip ? FINAL_VIDEO_PADDING : 0),
        };
      }),
    });

    yield* Console.log(result);

    return { success: true };
  }).pipe(withDatabaseDump, Effect.provide(layerLive), Effect.runPromise);
};
