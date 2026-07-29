import { Effect } from "effect";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

/**
 * Hard DELETE, permanently — a deliberate divergence from the diagram /
 * snapshot soft-delete convention. Nothing references a component, so losing
 * one costs a re-capture; snapshots are load-bearing for filmed clips,
 * components are not.
 */
export const action = makeAction({
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const componentOps = yield* DiagramComponentOperationsService;
      const deleted = yield* componentOps.deleteComponent(params.componentId!);
      return data(deleted);
    }),
});
