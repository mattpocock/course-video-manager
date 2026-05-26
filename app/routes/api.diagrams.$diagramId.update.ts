import { Effect, Schema } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

const updateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  archived: Schema.optional(Schema.String),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(updateSchema)(payload);

      const fields: { name?: string; archived?: boolean } = {};
      if (parsed.name !== undefined) {
        const trimmed = parsed.name.trim();
        if (!trimmed)
          return yield* Effect.die(
            data("Name cannot be empty", { status: 400 })
          );
        fields.name = trimmed;
      }
      if (parsed.archived !== undefined)
        fields.archived = parsed.archived === "true";

      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.updateDiagram(
        params.diagramId!,
        fields
      );
      return data({ diagram });
    }),
});
