import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction } from "@/services/route-action.server";
import type { Route } from "./+types/api.clips.$clipId.diagram-pin";
import { data } from "react-router";

const innerAction = makeAction({
  input: "json",
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return yield* Effect.die(
          data("Body must be a JSON object", { status: 400 })
        );
      }

      if (!("diagramSnapshotId" in payload)) {
        return yield* Effect.die(
          data("Missing diagramSnapshotId field", { status: 400 })
        );
      }

      const { diagramSnapshotId } = payload as { diagramSnapshotId: unknown };
      if (diagramSnapshotId !== null && typeof diagramSnapshotId !== "string") {
        return yield* Effect.die(
          data("diagramSnapshotId must be a string or null", { status: 400 })
        );
      }

      const diagramOps = yield* DiagramOperationsService;
      const clip = yield* diagramOps.updateClipDiagramPin(
        params.clipId!,
        diagramSnapshotId
      );
      return data({ clip });
    }),
});

export const action = async (args: Route.ActionArgs) => {
  if (args.request.method !== "PATCH") {
    return data("Method not allowed", { status: 405 });
  }
  return innerAction(args);
};
