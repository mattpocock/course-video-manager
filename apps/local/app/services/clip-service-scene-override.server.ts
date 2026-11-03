import { clips, recordingSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { canZoomClip } from "@/features/videos/clip-zoom";
import { effectiveClipScene } from "@cvm/core/features/videos/effective-scene";
import type { RecordingSessionScene } from "@cvm/core/features/videos/recorder";
import { sceneOverrideScenes } from "@/packages/clip-source";
import type { Database } from "@/services/drizzle-service.server";
import {
  type LoggerAdapter,
  dbCall,
  touchVideoUpdatedAt,
} from "./clip-service-handler.helpers";

export const OBS_CLIP_SCENE_OVERRIDE_MESSAGE =
  "An OBS Clip cannot have a Scene Override: its scene is baked into its Footage.";

/** Why a screen-drawing scene cannot be a camera-only Clip's override. */
export const screenlessSceneOverrideMessage = (scene: RecordingSessionScene) =>
  `${scene} shows the screen, and this Clip's Recording Session captured no screen: only Camera can be drawn.`;

/**
 * Set (or, with null, clear) a CVM-recorder Clip's Scene Override.
 *
 * A Clip Zoom is legal only on a camera scene, judged on the effective scene.
 * An override that leaves the Clip off a camera scene drops its zoom in the
 * same write, so the stored Clip never carries a zoom the rule forbids.
 *
 * A camera-only Recording Session (a Short filmed without its screen) can
 * only be overridden to a scene that draws no screen: Camera.
 */
export const updateSceneOverride = (
  db: Database,
  logger: LoggerAdapter,
  event: { clipId: string; sceneOverride: RecordingSessionScene | null }
) =>
  Effect.gen(function* () {
    const clip = yield* dbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, event.clipId),
        with: { layers: { columns: { kind: true } } },
      })
    );
    if (!clip) {
      throw new Error(`Clip not found: ${event.clipId}`);
    }
    if (!clip.recordingSessionId) {
      throw new Error(OBS_CLIP_SCENE_OVERRIDE_MESSAGE);
    }
    if (event.sceneOverride) {
      const session = yield* dbCall(() =>
        db.query.recordingSessions.findFirst({
          where: eq(recordingSessions.id, clip.recordingSessionId!),
        })
      );
      if (
        session &&
        !sceneOverrideScenes(session).includes(event.sceneOverride)
      ) {
        throw new Error(screenlessSceneOverrideMessage(event.sceneOverride));
      }
    }

    const scene = effectiveClipScene({
      scene: clip.scene,
      sceneOverride: event.sceneOverride,
    });
    const zoomType = canZoomClip(scene, clip.layers) ? clip.zoomType : "none";

    yield* dbCall(() =>
      db
        .update(clips)
        .set({ sceneOverride: event.sceneOverride, zoomType })
        .where(eq(clips.id, event.clipId))
    );

    yield* touchVideoUpdatedAt(db, clip.videoId);
    logger.log(clip.videoId, {
      type: "scene-override-updated",
      clipId: event.clipId,
      sceneOverride: event.sceneOverride,
    });
  });
