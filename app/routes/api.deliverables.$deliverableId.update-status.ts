import { Console, Effect, Schema } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";
import type { Route } from "./+types/api.deliverables.$deliverableId.update-status";

const updateStatusSchema = Schema.Struct({
  status: Schema.Literal("planned", "done", "cancelled"),
});

export const action = async (args: Route.ActionArgs) => {
  const { deliverableId } = args.params;
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const { status } =
      yield* Schema.decodeUnknown(updateStatusSchema)(formDataObject);

    const deliverableOps = yield* DeliverableOperationsService;
    const deliverable = yield* deliverableOps.updateDeliverableStatus({
      id: deliverableId,
      status,
    });

    return data({ id: deliverable.id, status: deliverable.status });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
