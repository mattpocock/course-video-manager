import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { data } from "react-router";

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagrams = yield* diagramOps.listDiagrams();
      return data({ diagrams });
    }),
});
