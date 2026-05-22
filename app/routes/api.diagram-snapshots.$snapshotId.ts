import { Console, Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.diagram-snapshots.$snapshotId";
import { data } from "react-router";

export const loader = async (args: Route.LoaderArgs) => {
  const { snapshotId } = args.params;

  return Effect.gen(function* () {
    const diagramOps = yield* DiagramOperationsService;
    const snapshot = yield* diagramOps.getDiagramSnapshot(snapshotId);
    return data({
      scene: snapshot.scene,
      diagramId: snapshot.diagramId,
      contentHash: snapshot.contentHash,
    });
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
