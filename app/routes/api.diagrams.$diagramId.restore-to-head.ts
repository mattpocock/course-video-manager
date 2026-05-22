import { Console, Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.diagrams.$diagramId.restore-to-head";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const { diagramId } = args.params;
  const body = await args.request.json();

  return Effect.gen(function* () {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return yield* Effect.die(
        data("Body must be a JSON object", { status: 400 })
      );
    }

    const snapshotId = body.snapshotId;
    if (typeof snapshotId !== "string" || !snapshotId) {
      return yield* Effect.die(
        data("snapshotId is required and must be a string", { status: 400 })
      );
    }

    const diagramOps = yield* DiagramOperationsService;
    const diagram = yield* diagramOps.restoreSnapshotToHead(
      diagramId,
      snapshotId
    );

    return data({ diagram });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Diagram or snapshot not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
