import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { newestSnapshotHashByDiagram } from "@/lib/filtered-newest-snapshot";
import { data } from "react-router";

/**
 * How many recent diagrams an empty query returns. Three columns of four rows
 * — enough to fill the palette's result box without making it scroll on open.
 */
const RECENT_LIMIT = 12;

/**
 * Content search for the command palette. The shipped `searchDiagrams` is
 * reused AS-IS — no new query and no change to the service — so search means
 * the same thing inside a diagram window as it does on Playground Home, which
 * calls the same operation from its own loader.
 *
 * An EMPTY query is not an empty result: it returns the most recently touched
 * diagrams, in the same recency order (and with the same thumbnail) as
 * Playground Home's grid. Opening "Go to diagram" therefore lands on something
 * jumpable rather than on a "type to search" placeholder. They come back
 * shaped exactly like search hits — `source: "current"`, no `snapshotId` — so
 * selecting one is a plain navigation, never a restore.
 */
export const loader = makeLoader({
  effect: ({ request }) =>
    Effect.gen(function* () {
      const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
      const diagramOps = yield* DiagramOperationsService;

      if (!q) {
        const [recent, allSnapshots] = yield* Effect.all(
          [diagramOps.listDiagrams(), diagramOps.listAllSnapshotsWithClips()],
          { concurrency: "unbounded" }
        );
        const hashes = newestSnapshotHashByDiagram(allSnapshots);
        return data({
          results: recent.slice(0, RECENT_LIMIT).map((d) => ({
            snapshotId: null,
            diagramId: d.id,
            diagramName: d.name,
            contentHash: hashes.get(d.id) ?? null,
            // No query means no matched text to snippet.
            searchText: null,
            source: "current" as const,
          })),
        });
      }

      const results = yield* diagramOps.searchDiagrams(q);
      return data({
        results: results.map(({ sortKey: _sortKey, ...rest }) => rest),
      });
    }),
});
