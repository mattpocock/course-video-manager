import { Console, Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.diagrams.list";
import { data } from "react-router";

export const loader = async (_args: Route.LoaderArgs) => {
  return Effect.gen(function* () {
    const diagramOps = yield* DiagramOperationsService;
    const diagrams = yield* diagramOps.listDiagrams();
    return data({ diagrams });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
