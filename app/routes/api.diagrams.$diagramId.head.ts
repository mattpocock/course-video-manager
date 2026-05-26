import { Console, Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { makeAction } from "@/services/route-action.server";
import type { Route } from "./+types/api.diagrams.$diagramId.head";
import { data } from "react-router";

export const loader = async (args: Route.LoaderArgs) => {
  const { diagramId } = args.params;

  return Effect.gen(function* () {
    const diagramOps = yield* DiagramOperationsService;
    const diagram = yield* diagramOps.getDiagram(diagramId);
    return data({ headScene: diagram.headScene });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Diagram not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

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
