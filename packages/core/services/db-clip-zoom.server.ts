import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { Database } from "./drizzle-service.server.js";
import { clipLayers, clips } from "../db/schema.js";
import {
  ClipNotZoomableError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import { requireDraftVersionForClip } from "./draft-guard.server.js";
import {
  checkClipZoomEligibility,
  clipZoomIneligibilityMessage,
} from "../features/videos/clip-zoom.js";
import { effectiveClipScene } from "../features/videos/effective-scene.js";

/**
 * Set a Clip's Clip Zoom.
 *
 * A dedicated operation rather than another optional field on `updateClip`,
 * because the write carries a rule `updateClip` has no business knowing:
 * a zoom is legal only on a camera scene, judged on the Clip's effective
 * scene (its Scene Override, else its recorded scene), and only on a Clip
 * whose Layers have a Scene Layer (the one Layer it zooms). Enforcing it here means
 * the CLI and any future caller inherit the rule instead of reimplementing it.
 */
export const createSetClipZoom = <E>(
  db: Database,
  deps: {
    getClipById: (
      clipId: string
    ) => Effect.Effect<
      { scene: string | null; sceneOverride: string | null },
      E
    >;
  }
) =>
  Effect.fn("setClipZoom")(function* (clipId: string, zoomType: string) {
    const clip = yield* deps.getClipById(clipId);

    const scene = effectiveClipScene(clip);
    const layers = yield* Effect.tryPromise({
      try: () =>
        db.query.clipLayers.findMany({
          where: eq(clipLayers.clipId, clipId),
          columns: { kind: true },
        }),
      catch: (cause) => new UnknownDBServiceError({ cause }),
    });
    const ineligibility = checkClipZoomEligibility(scene, layers);
    if (ineligibility) {
      return yield* new ClipNotZoomableError({
        clipId,
        scene,
        message: clipZoomIneligibilityMessage(ineligibility),
      });
    }

    yield* requireDraftVersionForClip(db, clipId);
    const [updated] = yield* Effect.tryPromise({
      try: () =>
        db
          .update(clips)
          .set({ zoomType })
          .where(eq(clips.id, clipId))
          .returning(),
      catch: (cause) => new UnknownDBServiceError({ cause }),
    });

    return updated!;
  });
