import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";

const youtubeDraftSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
});

/** The YouTube page saves its YouTube Draft here as it is typed. */
export const action = makeAction({
  input: "json",
  errors: { NotFoundError: 404, VersionNotDraftError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const draft = yield* Schema.decodeUnknown(youtubeDraftSchema)(payload);
      const videoOps = yield* VideoOperationsService;
      yield* videoOps.updateYoutubeDraft({
        videoId: params.videoId!,
        ...draft,
      });
      return { ok: true };
    }),
});
