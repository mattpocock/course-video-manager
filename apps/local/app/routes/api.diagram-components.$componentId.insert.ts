import { Effect } from "effect";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

/**
 * Take a Component's fragment for insertion — and bump its `lastUsedAt`.
 *
 * An ACTION, not a loader, because something must write. Bumping inside a
 * loader would be a mutating GET, and React Router re-runs loaders on
 * revalidation, so it would bump on things that are not insertions. A separate
 * fire-and-forget `touch` route would be honest but costs two round trips for a
 * route whose only job is a timestamp.
 */
export const action = makeAction({
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const componentOps = yield* DiagramComponentOperationsService;
      const component = yield* componentOps.takeComponentForInsert(
        params.componentId!
      );
      return data({ sceneFragment: component.sceneFragment });
    }),
});
