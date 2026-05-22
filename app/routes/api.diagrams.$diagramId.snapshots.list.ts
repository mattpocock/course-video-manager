import { Console, Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.diagrams.$diagramId.snapshots.list";
import { data } from "react-router";
import { isVisibleInTimeline } from "@/lib/timeline-visibility";
import { hashScene } from "@/lib/scene-hash";

export const loader = async (args: Route.LoaderArgs) => {
  const { diagramId } = args.params;

  return Effect.gen(function* () {
    const diagramOps = yield* DiagramOperationsService;
    const [snapshots, diagram] = yield* Effect.all([
      diagramOps.listSnapshotsWithClips(diagramId),
      diagramOps.getDiagram(diagramId),
    ]);
    const visibleSnapshots = snapshots.filter((s) =>
      isVisibleInTimeline(s, s.clips)
    );
    const headContentHash =
      diagram.headScene != null ? hashScene(diagram.headScene) : null;
    return data({ snapshots: visibleSnapshots, headContentHash });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
