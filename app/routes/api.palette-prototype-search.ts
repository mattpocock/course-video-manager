// PROTOTYPE — throwaway resource route for wayfinder issue #209.
// Exists only so the palette prototype can exercise the real server-side
// searchDiagrams path with cmdk's shouldFilter={false}. Delete with the branch.

import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { data } from "react-router";

export const loader = makeLoader({
  effect: ({ request }) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const q = url.searchParams.get("q")?.trim() ?? "";
      if (!q) return data({ results: [] });
      const diagramOps = yield* DiagramOperationsService;
      const results = yield* diagramOps.searchDiagrams(q);
      return data({
        results: results.map(({ sortKey: _sortKey, ...rest }) => rest),
      });
    }),
});
