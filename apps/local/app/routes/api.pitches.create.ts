import { Effect } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = makeAction({
  effect: () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      return data({ id: pitch.id });
    }),
});
