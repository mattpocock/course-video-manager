/**
 * Helper for the copyVideo operation of VideoOperationsService.
 *
 * Extracted into its own module to keep db-video-operations.server.ts under
 * the repo's 5500-token pre-commit limit.
 */

import { clips, chapters, videos, beats } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, eq } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { Effect } from "effect";
import type { Database } from "@/services/drizzle-service.server";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

export const copyVideoImpl = (
  db: Database,
  opts: {
    sourceVideoId: string;
    newPath: string;
    copyClips: boolean;
    copyBeats: boolean;
  }
): Effect.Effect<string, NotFoundError | UnknownDBServiceError> =>
  Effect.gen(function* () {
    const { sourceVideoId, newPath, copyClips, copyBeats } = opts;

    // Load source video outside the transaction so we can surface NotFoundError
    // before opening a transaction.
    const sourceVideo = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, sourceVideoId),
      })
    );

    if (!sourceVideo) {
      return yield* new NotFoundError({
        type: "copyVideo",
        params: { sourceVideoId },
      });
    }

    // All writes (and the reads they depend on) run inside a single transaction
    // so a partial failure leaves no orphaned rows.
    const newVideoId = yield* makeDbCall(() =>
      db.transaction(async (tx) => {
        const now = new Date();

        // Insert new video row
        const newVideoRows = await tx
          .insert(videos)
          .values({
            path: newPath.trim(),
            originalFootagePath: sourceVideo.originalFootagePath,
            lessonId: sourceVideo.lessonId,
            pitchId: sourceVideo.pitchId,
            archived: false,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const newVideo = newVideoRows[0];
        if (!newVideo) {
          throw new Error("No video returned after insert");
        }

        if (copyClips) {
          // Load non-archived clips
          const sourceClips = await tx.query.clips.findMany({
            where: and(
              eq(clips.videoId, sourceVideoId),
              eq(clips.archived, false)
            ),
            orderBy: asc(clips.order),
          });

          // Load non-archived chapters
          const sourceChapters = await tx.query.chapters.findMany({
            where: and(
              eq(chapters.videoId, sourceVideoId),
              eq(chapters.archived, false)
            ),
            orderBy: asc(chapters.order),
          });

          if (sourceClips.length > 0) {
            const clipOrders = generateNKeysBetween(
              null,
              null,
              sourceClips.length
            );
            await tx.insert(clips).values(
              sourceClips.map((clip, i) => ({
                videoId: newVideo.id,
                videoFilename: clip.videoFilename,
                sourceStartTime: clip.sourceStartTime,
                sourceEndTime: clip.sourceEndTime,
                order: clipOrders[i]!,
                archived: false,
                text: clip.text,
                transcribedAt: clip.transcribedAt,
                scene: clip.scene,
                profile: clip.profile,
                pauseType: clip.pauseType,
                diagramSnapshotId: clip.diagramSnapshotId,
              }))
            );
          }

          if (sourceChapters.length > 0) {
            const chapterOrders = generateNKeysBetween(
              null,
              null,
              sourceChapters.length
            );
            await tx.insert(chapters).values(
              sourceChapters.map((chapter, i) => ({
                videoId: newVideo.id,
                name: chapter.name,
                order: chapterOrders[i]!,
                archived: false,
              }))
            );
          }
        }

        if (copyBeats) {
          const sourceBeats = await tx.query.beats.findMany({
            where: and(
              eq(beats.videoId, sourceVideoId),
              eq(beats.archived, false)
            ),
            orderBy: asc(beats.order),
          });

          if (sourceBeats.length > 0) {
            const beatOrders = generateNKeysBetween(
              null,
              null,
              sourceBeats.length
            );
            await tx.insert(beats).values(
              sourceBeats.map((beat, i) => ({
                videoId: newVideo.id,
                kind: beat.kind,
                title: beat.title,
                description: beat.description,
                order: beatOrders[i]!,
              }))
            );
          }
        }

        return newVideo.id;
      })
    );

    return newVideoId;
  });
