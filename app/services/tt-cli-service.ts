import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Schema } from "effect";

const getLatestOBSVideoClipsSchema = Schema.Struct({
  clips: Schema.Array(
    Schema.Struct({
      inputVideo: Schema.String,
      startTime: Schema.Number,
      endTime: Schema.Number,
    })
  ),
});

const transcribeClipsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.String,
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
);

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
        function* (opts: {
          filePath: string | undefined;
          startTime: number | undefined;
        }) {
          const command = Command.make(
            "tt",
            "get-clips-from-latest-video",
            ...(opts.filePath ? [opts.filePath] : []),
            ...(opts.startTime
              ? ["--startTime", opts.startTime.toString()]
              : [])
          );

          const result = yield* Command.string(command);

          const parseResult = yield* Effect.try({
            try: () => JSON.parse(result.trim()) as unknown,
            catch: (e) =>
              new CouldNotParseJsonError({
                cause: e,
                message: `Could not parse JSON from get-clips-from-latest-video: ${result}`,
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

      const transcribeClips = Effect.fn("transcribeClips")(function* (
        clips: {
          id: string;
          inputVideo: string;
          startTime: number;
          duration: number;
        }[]
      ) {
        const command = Command.make(
          "tt",
          "transcribe-clips",
          JSON.stringify(clips)
        );
        const result = yield* Command.string(command);
        return yield* Schema.decodeUnknown(transcribeClipsSchema)(
          JSON.parse(result.trim())
        );
      });

      return {
        getLatestOBSVideoClips,
        exportVideoClips,
        transcribeClips,
      };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
