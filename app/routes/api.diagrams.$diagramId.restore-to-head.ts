import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = makeAction({
  input: "json",
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const body = payload as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return yield* Effect.die(
          data("Body must be a JSON object", { status: 400 })
        );
      }

      const snapshotId = body.snapshotId;
      if (typeof snapshotId !== "string" || !snapshotId) {
        return yield* Effect.die(
          data("snapshotId is required and must be a string", { status: 400 })
        );
      }

      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.restoreSnapshotToHead(
        params.diagramId!,
        snapshotId
      );

      return data({ diagram });
    }),
});
