import { Effect } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = makeAction({
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const video = yield* pitchOps.createVideoFromPitch(params.pitchId!);
      return data({ id: video.id });
    }),
});
