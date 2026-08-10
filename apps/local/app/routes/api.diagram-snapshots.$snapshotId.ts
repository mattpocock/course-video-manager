import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { data } from "react-router";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const snapshot = yield* diagramOps.getDiagramSnapshot(params.snapshotId!);
      return data({
        scene: snapshot.scene,
        diagramId: snapshot.diagramId,
        contentHash: snapshot.contentHash,
      });
    }),
});
