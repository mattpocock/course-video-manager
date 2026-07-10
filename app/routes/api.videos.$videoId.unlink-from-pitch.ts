import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  input: "formData",
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      yield* videoOps.unlinkVideoFromPitch(params.videoId!);
      return { success: true };
    }),
});
