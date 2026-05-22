import { Console, Effect, Schema } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.diagrams.$diagramId.update";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const updateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  archived: Schema.optional(Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const { diagramId } = args.params;
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(updateSchema)(formDataObject);

    const fields: { name?: string; archived?: boolean } = {};
    if (parsed.name !== undefined) {
      const trimmed = parsed.name.trim();
      if (!trimmed)
        return yield* Effect.die(data("Name cannot be empty", { status: 400 }));
      fields.name = trimmed;
    }
    if (parsed.archived !== undefined)
      fields.archived = parsed.archived === "true";

    const diagramOps = yield* DiagramOperationsService;
    const diagram = yield* diagramOps.updateDiagram(diagramId, fields);
    return data({ diagram });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
