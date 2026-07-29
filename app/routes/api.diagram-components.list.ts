import { Effect } from "effect";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { data } from "react-router";

/**
 * The payload is `{id, name}` only: the server owns the ordering (lastUsedAt
 * desc), client-side filtering preserves it, and nothing in the grid displays a
 * date. Both timestamps stay in the table and never cross the wire.
 */
export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const componentOps = yield* DiagramComponentOperationsService;
      const components = yield* componentOps.listComponents();
      return data({ components });
    }),
});
