import { Effect } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = async (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => {
  const formData = await args.request.formData();
  const ids = [
    ...new Set(
      formData
        .getAll("ids")
        .filter((v): v is string => typeof v === "string" && v !== "")
    ),
  ];

  return makeAction({
    effect: () =>
      Effect.gen(function* () {
        if (ids.length === 0) {
          return yield* Effect.die(data("No ids provided", { status: 400 }));
        }

        const deliverableOps = yield* DeliverableOperationsService;
        const results = yield* Effect.forEach(
          ids,
          (id) => deliverableOps.duplicateDeliverable(id),
          { concurrency: 1 }
        );

        return { duplicated: results.length };
      }),
  })(args);
};
