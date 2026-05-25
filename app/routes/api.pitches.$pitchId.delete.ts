import { Console, Effect } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.pitches.$pitchId.delete";
import { withDatabaseDump } from "@/services/dump-service";
import { data, redirect } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const { pitchId } = args.params;
  const formData = await args.request.formData();
  const redirectTo = formData.get("redirectTo");

  return Effect.gen(function* () {
    const pitchOps = yield* PitchOperationsService;
    yield* pitchOps.deletePitch(pitchId);
    if (
      typeof redirectTo === "string" &&
      redirectTo.startsWith("/") &&
      !redirectTo.startsWith("//")
    ) {
      return redirect(redirectTo);
    }
    return data({ success: true });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
