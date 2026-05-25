import { Console, Effect } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import type { Route } from "./+types/api.pitches.$pitchId.create-video";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const { pitchId } = args.params;

  return Effect.gen(function* () {
    const pitchOps = yield* PitchOperationsService;
    const video = yield* pitchOps.createVideoFromPitch(pitchId);
    return data({ id: video.id });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Pitch not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
