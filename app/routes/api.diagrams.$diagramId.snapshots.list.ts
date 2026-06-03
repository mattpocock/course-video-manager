import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { data } from "react-router";
import { isVisibleInTimeline } from "@/lib/timeline-visibility";
import { hashScene } from "@/lib/scene-hash";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const [snapshots, diagram] = yield* Effect.all([
        diagramOps.listSnapshotsWithClips(params.diagramId!),
        diagramOps.getDiagram(params.diagramId!),
      ]);
      const visibleSnapshots = snapshots.filter((s) =>
        isVisibleInTimeline(s, s.clips)
      );
      const headContentHash =
        diagram.headScene != null ? hashScene(diagram.headScene) : null;
      return data({ snapshots: visibleSnapshots, headContentHash });
    }),
});
