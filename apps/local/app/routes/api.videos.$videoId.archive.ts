import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";

const archiveVideoSchema = Schema.Struct({
  archived: Schema.Literal("true", "false").pipe(
    Schema.transform(Schema.Boolean, {
      decode: (s) => s === "true",
      encode: (b) => (b ? "true" : "false") as "true" | "false",
    })
  ),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { archived } =
        yield* Schema.decodeUnknown(archiveVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      yield* videoOps.updateVideoArchiveStatus({
        videoId: params.videoId!,
        archived,
      });

      return { success: true };
    }),
});
