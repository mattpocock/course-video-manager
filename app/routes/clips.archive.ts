import { Effect, Schema } from "effect";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import type { Route } from "./+types/clips.archive";

const archiveClipsSchema = Schema.Struct({
  clipIds: Schema.Union(Schema.Array(Schema.String), Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const db = yield* DBService;
    const { clipIds } = yield* Schema.decodeUnknown(archiveClipsSchema)(
      formDataObject
    );

    const resolvedClipIds = typeof clipIds === "string" ? [clipIds] : clipIds;
    yield* Effect.forEach(resolvedClipIds, (clipId) => db.archiveClip(clipId));

    return { success: true };
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};
