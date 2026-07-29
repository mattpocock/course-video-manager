import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { data } from "react-router";

/**
 * Content search for the command palette. The shipped `searchDiagrams` is
 * reused AS-IS — no new query and no change to the service — so search means
 * the same thing inside a diagram window as it does on Playground Home, which
 * calls the same operation from its own loader.
 */
export const loader = makeLoader({
  effect: ({ request }) =>
    Effect.gen(function* () {
      const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
      if (!q) return data({ results: [] });

      const diagramOps = yield* DiagramOperationsService;
      const results = yield* diagramOps.searchDiagrams(q);
      return data({
        results: results.map(({ sortKey: _sortKey, ...rest }) => rest),
      });
    }),
});
