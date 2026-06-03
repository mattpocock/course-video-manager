import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction, makeLoader } from "@/services/route-action.server";
import type { Route } from "./+types/api.diagrams.$diagramId.head";
import { data } from "react-router";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.getDiagram(params.diagramId!);
      return data({ headScene: diagram.headScene });
    }),
});

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

      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.updateDiagramHead(
        params.diagramId!,
        payload
      );
      return data({ ok: true, updatedAt: diagram.updatedAt.toISOString() });
    }),
});

export const action = async (args: Route.ActionArgs) => {
  if (args.request.method !== "PATCH") {
    throw data("Method not allowed", { status: 405 });
  }
  return innerAction(args);
};
