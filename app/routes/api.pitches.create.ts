import { Console, Effect } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

export const action = async () => {
  return Effect.gen(function* () {
    const pitchOps = yield* PitchOperationsService;
    const pitch = yield* pitchOps.createPitch();
    return data({ id: pitch.id });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
