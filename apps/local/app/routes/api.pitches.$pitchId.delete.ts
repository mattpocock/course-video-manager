import { Effect } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data, redirect } from "react-router";

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const formDataObject = payload as Record<string, unknown>;
      const redirectTo = formDataObject.redirectTo;
      const pitchOps = yield* PitchOperationsService;
      yield* pitchOps.deletePitch(params.pitchId!);
      if (
        typeof redirectTo === "string" &&
        redirectTo.startsWith("/") &&
        !redirectTo.startsWith("//")
      ) {
        return redirect(redirectTo);
      }
      return data({ success: true });
    }),
});
