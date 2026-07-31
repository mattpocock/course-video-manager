import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { redirect } from "react-router";

const copyVideoSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Video name cannot be empty" })
  ),
  copyClips: Schema.optional(Schema.String),
  copyBeats: Schema.optional(Schema.String),
  copyScript: Schema.optional(Schema.String),
  renameOld: Schema.optional(Schema.String),
  /**
   * Where to send the user once the copy lands, with `{id}` standing in for the
   * new video's id. Surfaces that show the source video (the editor) follow the
   * user onto the copy; the tree views omit it and stay put. Mirrors
   * `api.videos.create`.
   */
  redirectTo: Schema.optional(Schema.String),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { name, copyClips, copyBeats, copyScript, renameOld, redirectTo } =
        yield* Schema.decodeUnknown(copyVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      const newVideoId = yield* videoOps.copyVideo({
        sourceVideoId: params.videoId!,
        newTitle: name.trim(),
        copyClips: copyClips === "on",
        copyBeats: copyBeats === "on",
        copyScript: copyScript === "on",
        renameOld: renameOld === "on",
      });

      if (
        redirectTo &&
        redirectTo.startsWith("/") &&
        !redirectTo.includes("//")
      ) {
        return redirect(redirectTo.replace("{id}", newVideoId)) as never;
      }

      return { success: true, newVideoId };
    }),
});
