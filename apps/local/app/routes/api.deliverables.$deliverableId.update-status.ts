import { Effect, Schema } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

const updateStatusSchema = Schema.Struct({
  status: Schema.Literal("planned", "done", "cancelled"),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { status } =
        yield* Schema.decodeUnknown(updateStatusSchema)(payload);

      const deliverableOps = yield* DeliverableOperationsService;
      const deliverable = yield* deliverableOps.updateDeliverableStatus({
        id: params.deliverableId!,
        status,
      });

      return data({ id: deliverable.id, status: deliverable.status });
    }),
});
