import { Effect } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = makeAction({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const deliverableOps = yield* DeliverableOperationsService;
      const result = yield* deliverableOps.duplicateDeliverable(
        params.deliverableId!
      );
      return data({ id: result.created.id });
    }),
});
