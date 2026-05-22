import { Console, Effect } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";
import type { Route } from "./+types/api.deliverables.duplicate-week";

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const ids = [
    ...new Set(
      formData
        .getAll("ids")
        .filter((v): v is string => typeof v === "string" && v !== "")
    ),
  ];

  return Effect.gen(function* () {
    if (ids.length === 0) {
      return yield* Effect.die(data("No ids provided", { status: 400 }));
    }

    const deliverableOps = yield* DeliverableOperationsService;
    const results = yield* Effect.forEach(
      ids,
      (id) => deliverableOps.duplicateDeliverable(id),
      { concurrency: 1 }
    );

    return data({ duplicated: results.length });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
