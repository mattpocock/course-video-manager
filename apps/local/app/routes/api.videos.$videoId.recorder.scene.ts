import { Effect, Schema } from "effect";
import { SCENES } from "@/packages/scene-layout";
import { recorderCommand } from "@/services/recorder-client/client.server";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const switchSceneSchema = Schema.Struct({ scene: Schema.Literal(...SCENES) });

/**
 * Switch scene, on a New recorder Video: the preview draws the new scene at
 * once and, while recording, the recorder logs the switch as a scene event.
 */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { scene } = yield* Schema.decodeUnknown(switchSceneSchema)(payload);
      const videoId = params.videoId!;
      yield* recorderCommand(() =>
        recorderClient().switchScene(videoId, scene)
      );
      return { ok: true };
    }),
});
