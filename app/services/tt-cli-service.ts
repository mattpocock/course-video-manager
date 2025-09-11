import { Data, Effect, Schema } from "effect";
import { Command } from "@effect/platform";
import {
  NodeCommandExecutor,
  NodeContext,
  NodeRuntime,
} from "@effect/platform-node";

const getLatestOBSVideoClipsSchema = Schema.Struct({
  clips: Schema.Array(
    Schema.Struct({
      inputVideo: Schema.String,
      startTime: Schema.Number,
      endTime: Schema.Number,
      words: Schema.Array(
        Schema.Struct({
          start: Schema.Number,
          end: Schema.Number,
          text: Schema.String,
        })
      ),
      segments: Schema.Array(
        Schema.Struct({
          start: Schema.Number,
          end: Schema.Number,
          text: Schema.String,
        })
      ),
    })
  ),
});

class CouldNotParseJsonError extends Data.TaggedError(
  "CouldNotParseJsonError"
)<{
  cause: unknown;
  message: string;
}> {}

export class TotalTypeScriptCLIService extends Effect.Service<TotalTypeScriptCLIService>()(
  "TotalTypeScriptCLIService",
  {
    effect: Effect.gen(function* () {
      const getLatestOBSVideoClips = Effect.fn("getLatestOBSVideoClips")(
        function* () {
          const command = Command.make("tt", "get-clips-from-latest-video");

          const result = yield* Command.string(command);

          const parseResult = yield* Effect.try({
            try: () => JSON.parse(result.trim()) as unknown,
            catch: (e) =>
              new CouldNotParseJsonError({
                cause: e,
                message: `Could not parse JSON from get-clips-from-latest-video command`,
              }),
          });

          return yield* Schema.decodeUnknown(getLatestOBSVideoClipsSchema)(
            parseResult
          );
        }
      );

      const exportVideoClips = Effect.fn("exportVideoClips")(function* (
        videoId: string,
        clips: {
          inputVideo: string;
          startTime: number;
          duration: number;
        }[]
      ) {
        const command = Command.make(
          "tt",
          "create-video-from-clips",
          JSON.stringify(clips),
          videoId
        );
        const result = yield* Command.string(command);
        return result;
      });

      return {
        getLatestOBSVideoClips,
        exportVideoClips,
      };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
