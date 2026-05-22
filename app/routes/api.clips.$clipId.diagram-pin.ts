import { Console, Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.clips.$clipId.diagram-pin";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const { clipId } = args.params;

  if (args.request.method !== "PATCH") {
    return data("Method not allowed", { status: 405 });
  }

  const body = await args.request.json();

  return Effect.gen(function* () {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return yield* Effect.die(
        data("Body must be a JSON object", { status: 400 })
      );
    }

    if (!("diagramSnapshotId" in body)) {
      return yield* Effect.die(
        data("Missing diagramSnapshotId field", { status: 400 })
      );
    }

    const { diagramSnapshotId } = body;
    if (diagramSnapshotId !== null && typeof diagramSnapshotId !== "string") {
      return yield* Effect.die(
        data("diagramSnapshotId must be a string or null", { status: 400 })
      );
    }

    const diagramOps = yield* DiagramOperationsService;
    const clip = yield* diagramOps.updateClipDiagramPin(
      clipId,
      diagramSnapshotId
    );
    return data({ clip });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Clip not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
