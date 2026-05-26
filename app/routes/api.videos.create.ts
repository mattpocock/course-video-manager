import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

const createVideoSchema = Schema.Struct({
  path: Schema.String,
});

export const action = makeAction({
  input: "formData",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(createVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      const video = yield* videoOps.createStandaloneVideo({
        path: result.path,
      });

      return data({ id: video.id });
    }),
});
