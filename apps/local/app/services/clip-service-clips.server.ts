import { clips } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  checkClipZoomEligibility,
  clipZoomIneligibilityMessage,
} from "@/features/videos/clip-zoom";
import { effectiveClipScene } from "@cvm/core/features/videos/effective-scene";
import { writeClipText } from "@cvm/core/services/db-transcript-word-operations.server";
import type { Database } from "@/services/drizzle-service.server";
import type { ClipServiceEventOf } from "./clip-service";
import {
  type LoggerAdapter,
  dbCall,
  touchVideoUpdatedAt,
} from "./clip-service-handler.helpers";

const findClip = (db: Database, clipId: string) =>
  dbCall(() =>
    db.query.clips.findFirst({
      where: eq(clips.id, clipId),
    })
  );

/**
 * Set every listed Clip's `archived` flag, then touch the Video the first
 * one belongs to and log `type` against it.
 */
const setClipsArchived = (
  db: Database,
  logger: LoggerAdapter,
  clipIds: readonly string[],
  archived: boolean,
  type: "clips-archived" | "clips-unarchived"
) =>
  Effect.gen(function* () {
    for (const clipId of clipIds) {
      yield* dbCall(() =>
        db.update(clips).set({ archived }).where(eq(clips.id, clipId))
      );
    }

    // We need the videoId for logging — look up from first clip
    if (clipIds.length > 0) {
      const firstClip = yield* findClip(db, clipIds[0]!);
      if (firstClip) {
        yield* touchVideoUpdatedAt(db, firstClip.videoId);
        logger.log(firstClip.videoId, { type, clipIds: [...clipIds] });
      }
    }
  });

export const archiveClips = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"archive-clips">
) => setClipsArchived(db, logger, event.clipIds, true, "clips-archived");

export const unarchiveClips = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"unarchive-clips">
) => setClipsArchived(db, logger, event.clipIds, false, "clips-unarchived");

export const updateClips = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"update-clips">
) =>
  Effect.gen(function* () {
    for (const clip of event.clips) {
      yield* dbCall(() =>
        db
          .update(clips)
          .set({
            scene: clip.scene,
            profile: clip.profile,
            pauseType: clip.pauseType,
          })
          .where(eq(clips.id, clip.id))
      );
    }

    if (event.clips.length > 0) {
      const firstClip = yield* findClip(db, event.clips[0]!.id);
      if (firstClip) {
        yield* touchVideoUpdatedAt(db, firstClip.videoId);
        logger.log(firstClip.videoId, {
          type: "clips-updated",
          clips: event.clips.map((c) => ({
            id: c.id,
            scene: c.scene,
            profile: c.profile,
            pauseType: c.pauseType,
          })),
        });
      }
    }
  });

export const updatePause = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"update-pause">
) =>
  Effect.gen(function* () {
    yield* dbCall(() =>
      db
        .update(clips)
        .set({ pauseType: event.pauseType })
        .where(eq(clips.id, event.clipId))
    );

    const clip = yield* findClip(db, event.clipId);
    if (clip) {
      yield* touchVideoUpdatedAt(db, clip.videoId);
      logger.log(clip.videoId, {
        type: "pause-updated",
        clipId: event.clipId,
        pauseType: event.pauseType,
      });
    }
  });

export const updateClipText = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"update-clip-text">
) =>
  Effect.gen(function* () {
    const clip = yield* writeClipText(db, event.clipId, event.text);
    if (!clip) {
      throw new Error(`Clip not found: ${event.clipId}`);
    }
    yield* touchVideoUpdatedAt(db, clip.videoId);
    logger.log(clip.videoId, {
      type: "clip-text-updated",
      clipId: event.clipId,
    });
  });

export const updateZoom = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"update-zoom">
) =>
  Effect.gen(function* () {
    // The eligibility rule is enforced here, not only at the call sites,
    // so every caller inherits it. The editor hides the affordance on an
    // ineligible clip and the CLI pre-checks to report a clean typed
    // error, but neither of those is what makes the rule hold.
    const clip = yield* dbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, event.clipId),
        with: { layers: { columns: { kind: true } } },
      })
    );
    if (!clip) {
      throw new Error(`Clip not found: ${event.clipId}`);
    }

    const ineligibility = checkClipZoomEligibility(
      effectiveClipScene(clip),
      clip.layers
    );
    if (ineligibility) {
      throw new Error(clipZoomIneligibilityMessage(ineligibility));
    }

    yield* dbCall(() =>
      db
        .update(clips)
        .set({ zoomType: event.zoomType })
        .where(eq(clips.id, event.clipId))
    );

    yield* touchVideoUpdatedAt(db, clip.videoId);
    logger.log(clip.videoId, {
      type: "zoom-updated",
      clipId: event.clipId,
      zoomType: event.zoomType,
    });
  });
