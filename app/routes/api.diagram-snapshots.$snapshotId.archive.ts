import { Console, Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.diagram-snapshots.$snapshotId.archive";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const { snapshotId } = args.params;
  const body = await args.request.json().catch(() => null);
  const archived =
    body && typeof body === "object" && typeof body.archived === "boolean"
      ? body.archived
      : true;

  return Effect.gen(function* () {
    const diagramOps = yield* DiagramOperationsService;
    const snapshot = yield* diagramOps.setSnapshotArchived(
      snapshotId,
      archived
    );
    return data({ snapshot });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Snapshot not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
