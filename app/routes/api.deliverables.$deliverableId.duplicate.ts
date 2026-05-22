import { Console, Effect } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";
import type { Route } from "./+types/api.deliverables.$deliverableId.duplicate";

export const action = async (args: Route.ActionArgs) => {
  const { deliverableId } = args.params;

  return Effect.gen(function* () {
    const deliverableOps = yield* DeliverableOperationsService;
    const result = yield* deliverableOps.duplicateDeliverable(deliverableId);

    return data({ id: result.created.id });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
