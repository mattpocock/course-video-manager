import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data, redirect } from "react-router";
import { DEFAULT_VIDEO_FORMAT } from "@/features/videos/video-format";

const createVideoSchema = Schema.Struct({
  title: Schema.String,
  format: Schema.optional(
    Schema.Union(Schema.Literal("landscape"), Schema.Literal("short"))
  ),
  redirectTo: Schema.optional(Schema.String),
});

export const action = makeAction({
  input: "formData",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(createVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      const video = yield* videoOps.createStandaloneVideo({
        title: result.title,
        format: result.format ?? DEFAULT_VIDEO_FORMAT,
      });

      if (
        result.redirectTo &&
        result.redirectTo.startsWith("/") &&
        !result.redirectTo.includes("//")
      ) {
        return redirect(result.redirectTo.replace("{id}", video.id)) as never;
      }

      return data({ id: video.id });
    }),
});
