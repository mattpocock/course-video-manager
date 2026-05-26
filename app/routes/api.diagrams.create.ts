import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = makeAction({
  effect: () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      return data({ id: diagram.id, name: diagram.name });
    }),
});
