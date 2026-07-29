import { Effect } from "effect";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

/**
 * Capture a selection as a Component.
 *
 * The body is the bare `TLContent` that `editor.getContentFromCurrentPage`
 * produces — `{shapes, bindings, assets, rootShapeIds, schema}` — with the
 * `users` key dropped (collaborator presence records, meaningless here). The
 * `{type: "application/tldraw", kind: "content", …}` wrapper is a clipboard
 * TRANSPORT concern and is deliberately not persisted.
 */
export const action = makeAction({
  input: "json",
  dump: false,
  errors: { InvalidComponentError: 400 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const body = payload as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return yield* Effect.die(
          data("Body must be a JSON object", { status: 400 })
        );
      }

      const name = typeof body.name === "string" ? body.name : "";
      // `Buffer.from(…, "base64")` never throws — it drops characters outside
      // the alphabet — so there is nothing to catch here. An absent or
      // non-string thumbnail becomes `undefined`, which the service rejects as
      // a 400 (a component with no thumbnail is unusable in a grid picker).
      const thumbnailPng =
        typeof body.thumbnailPngBase64 === "string"
          ? Buffer.from(body.thumbnailPngBase64, "base64")
          : undefined;

      const componentOps = yield* DiagramComponentOperationsService;
      const component = yield* componentOps.createComponent({
        name,
        sceneFragment: body.sceneFragment,
        thumbnailPng,
      });

      return data(component);
    }),
});
