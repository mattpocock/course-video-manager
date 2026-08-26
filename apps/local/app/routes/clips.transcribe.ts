import { transcribeAndPersistClips } from "@/services/clip-transcription";
import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/clips.transcribe";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";

const transcribeClipsSchema = Schema.Struct({
  clipIds: Schema.Array(Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const json = await args.request.json();

  return Effect.gen(function* () {
    const { clipIds } = yield* Schema.decodeUnknown(transcribeClipsSchema)(
      json
    );

    return yield* transcribeAndPersistClips(clipIds);
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
