import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction } from "@/services/route-action.server";
import type { Route } from "./+types/api.diagram-snapshots.$snapshotId.archive";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json().catch(() => null);
  const archived =
    body && typeof body === "object" && typeof body.archived === "boolean"
      ? body.archived
      : true;

  return makeAction({
    dump: false,
    errors: { NotFoundError: 404 },
    effect: ({ params }) =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const snapshot = yield* diagramOps.setSnapshotArchived(
          params.snapshotId!,
          archived
        );
        return data({ snapshot });
      }),
  })(args);
};
