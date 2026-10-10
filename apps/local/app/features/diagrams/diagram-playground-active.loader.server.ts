import { createHash } from "node:crypto";
import { Console, Effect } from "effect";
import { data } from "react-router";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { runRouteEffect } from "@/services/route-action.server";
import { filteredNewestSnapshot } from "@/lib/filtered-newest-snapshot";
import { hashHead } from "@/lib/scene-hash";

/**
 * The Diagram rail, plus the Active Diagram's stored head as a hash and the
 * time it was written. Only the Active Diagram's drawing is read; the rail is
 * metadata and snapshot hashes, so a poll's cost does not grow with every
 * other Diagram's drawing. The page revalidates this every few seconds, and
 * compares the head against the one its canvas last loaded or saved.
 *
 * `timelineHash` stands for the Active Diagram's snapshots, drawings included:
 * a snapshot redrawn in place (`cvm diagram snapshot update`) keeps its id but
 * changes this, so the timeline refetches it.
 */
export const loadDiagramPlaygroundActive = async ({
  params,
}: {
  params: { diagramId?: string };
}) => {
  return Effect.gen(function* () {
    const diagramOps = yield* DiagramOperationsService;
    const activeId = params.diagramId;
    const [diagrams, allSnapshots, active] = yield* Effect.all(
      [
        diagramOps.listDiagrams(),
        diagramOps.listAllSnapshotsWithClips(),
        activeId
          ? diagramOps.getDiagramHead(activeId).pipe(
              Effect.map((d) => ({
                diagramId: d.id,
                headHash: hashHead(d.headScene),
                updatedAt: d.updatedAt.toISOString(),
              })),
              Effect.catchTag("NotFoundError", () => Effect.succeed(null))
            )
          : Effect.succeed(null),
      ],
      { concurrency: "unbounded" }
    );

    const snapshotsByDiagram = new Map<
      string,
      {
        id: string;
        contentHash: string;
        preserved: boolean;
        createdAt: Date;
        clips: { archived: boolean }[];
      }[]
    >();
    for (const s of allSnapshots) {
      let arr = snapshotsByDiagram.get(s.diagramId);
      if (!arr) {
        arr = [];
        snapshotsByDiagram.set(s.diagramId, arr);
      }
      arr.push(s);
    }

    const timelineHash = (diagramId: string) =>
      createHash("sha1")
        .update(
          (snapshotsByDiagram.get(diagramId) ?? [])
            .map((s) => `${s.id}:${s.contentHash}`)
            .join("\n")
        )
        .digest("hex");

    return data({
      activeHead: active && {
        ...active,
        timelineHash: timelineHash(active.diagramId),
      },
      diagrams: diagrams.map((d) => {
        const snapshots = snapshotsByDiagram.get(d.id) ?? [];
        const newestId = filteredNewestSnapshot(snapshots);
        const newestSnapshot = newestId
          ? snapshots.find((s) => s.id === newestId)
          : null;
        return {
          id: d.id,
          name: d.name,
          thumbnailContentHash: newestSnapshot?.contentHash ?? null,
        };
      }),
    });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() =>
      Effect.die(data("Internal server error", { status: 500 }))
    ),
    (effect) => runRouteEffect(runtimeLive, effect)
  );
};
