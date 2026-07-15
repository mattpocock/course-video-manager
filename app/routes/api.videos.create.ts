import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data, redirect } from "react-router";

const createVideoSchema = Schema.Struct({
  title: Schema.String,
  format: Schema.optional(
    Schema.Union(Schema.Literal("standard"), Schema.Literal("short"))
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
        ...(result.format ? { format: result.format } : {}),
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
