import { withDatabaseDump } from "@/services/dump-service";
import { Effect, Schema } from "effect";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import type { Route } from "./+types/clips.update-scene";

const updateSceneSchema = Schema.Struct({
  clips: Schema.Array(Schema.Tuple(Schema.String, Schema.String)),
});

export const action = async (args: Route.ActionArgs) => {
  const json = await args.request.json();

  return Effect.gen(function* () {
    const db = yield* DBService;
    const { clips } = yield* Schema.decodeUnknown(updateSceneSchema)(json);

    yield* Effect.forEach(clips, (clip) => {
      return db.updateClip(clip[0], { scene: clip[1] });
    });

    return { success: true };
  }).pipe(withDatabaseDump, Effect.provide(layerLive), Effect.runPromise);
};
