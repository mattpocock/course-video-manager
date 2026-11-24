import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { copyClipMockupAssetsForVideo } from "@/services/clip-mockup-copy-forward.server";
import { copyVideoFilesDirectory } from "@/services/video-files";
import { makeAction } from "@/services/route-action.server";

const copyVideoSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Video name cannot be empty" })
  ),
  copyClips: Schema.optional(Schema.String),
  copyBeats: Schema.optional(Schema.String),
  copyScript: Schema.optional(Schema.String),
  renameOld: Schema.optional(Schema.String),
});

export const action = makeAction({
  input: "formData",
  errors: { InvalidClipMockupPathError: 400 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { name, copyClips, copyBeats, copyScript, renameOld } =
        yield* Schema.decodeUnknown(copyVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      const sourceVideo = yield* videoOps.getVideoRowById(params.videoId!);

      const newVideoId = yield* videoOps.copyVideo({
        sourceVideoId: params.videoId!,
        newTitle: name.trim(),
        copyClips: copyClips === "on",
        copyBeats: copyBeats === "on",
        copyScript: copyScript === "on",
        renameOld: renameOld === "on",
      });

      // The rows are copied; the FILES are not. The duplicate has a fresh
      // `lineageId`, and both of the stores keyed by one are left behind:
      // its Clip Mockups keep their paths verbatim, so every frame and every
      // WAV would resolve into an empty directory (#1669), and
      // `video-files/{lineageId}/` does not exist at all, so the copy
      // would open with none of the source's writer context (#1674).
      // `@cvm/core` cannot do either — it has no disk.
      const newVideo = yield* videoOps.getVideoRowById(newVideoId);
      yield* copyClipMockupAssetsForVideo({
        sourceLineageId: sourceVideo.lineageId,
        newLineageId: newVideo.lineageId,
        newVideoId,
      });
      yield* copyVideoFilesDirectory(sourceVideo.lineageId, newVideo.lineageId);

      return { success: true, newVideoId };
    }),
});
