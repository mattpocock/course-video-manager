import { Effect } from "effect";
import {
  SearchOperationsService,
  type SearchKind,
} from "@/services/db-search-operations.server";
import { makeLoader } from "@/services/route-action.server";
import type { globalSearchReducer } from "@/features/global-search/global-search-reducer";

/** Every kind Global Search shows. Beats are left out (#2508). */
const GLOBAL_SEARCH_KINDS: ReadonlySet<SearchKind> = new Set<SearchKind>([
  "course",
  "section",
  "lesson",
  "video",
  "pitch",
]);

/**
 * Global Search's one read: `GET /api/global-search?q=…`, the shared search
 * (`cvm search`) at the top level. An empty query answers no hits.
 */
export const loader = makeLoader({
  effect: ({ request }) =>
    Effect.gen(function* () {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      const search = yield* SearchOperationsService;
      const hits = yield* search.search({
        root: null,
        query,
        types: GLOBAL_SEARCH_KINDS,
      });
      // A top-level search never answers null, and asks for no Beats.
      return {
        hits: (hits ?? []).filter(
          (hit): hit is globalSearchReducer.Hit => hit.kind !== "beat"
        ),
      };
    }),
});
