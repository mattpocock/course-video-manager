import { Effect, Schema } from "effect";
import { concatenateVideos } from "@/services/video-concatenation-service";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";
import { VIDEO_FORMATS } from "@/features/videos/video-format";

const ConcatenateSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  sourceVideoIds: Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(
    Schema.minItems(1)
  ),
  format: Schema.Literal(...VIDEO_FORMATS),
});

export const action = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknown(ConcatenateSchema)(payload);

      const newVideo = yield* concatenateVideos({
        name: input.name,
        sourceVideoIds: [...input.sourceVideoIds],
        format: input.format,
      });

      return data({ id: newVideo.id });
    }),
});
