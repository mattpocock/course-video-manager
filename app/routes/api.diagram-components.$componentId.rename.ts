import { Effect, Schema } from "effect";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

const renameSchema = Schema.Struct({ name: Schema.String });

/** Rename does NOT bump recency — curation is not use. */
export const action = makeAction({
  input: "formData",
  errors: { InvalidComponentError: 400, NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(renameSchema)(payload);
      const componentOps = yield* DiagramComponentOperationsService;
      const component = yield* componentOps.renameComponent(
        params.componentId!,
        parsed.name
      );
      return data({ component });
    }),
});
