/**
 * Helper for the copyVideo operation of VideoOperationsService.
 *
 * Extracted into its own module to keep db-video-operations.server.ts under
 * the repo's 5500-token pre-commit limit.
 */

import {
  clips,
  chapters,
  videos,
  beats,
  clipMockups,
  clipMockupChapters,
} from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { Effect } from "effect";
import { sortByOrder } from "../lib/sort-by-order.js";
import type { Database } from "./drizzle-service.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Returns a title no other non-archived video in the lesson is using, appending
 * " (2)", " (3)" … until one is free.
 *
 * Videos with no lesson aren't covered by video_lesson_title_uniq, so any title
 * works there.
 */
const freeTitleInLesson = async (
  tx: Tx,
  lessonId: string | null,
  desiredTitle: string,
  excludeVideoId: string
) => {
  if (!lessonId) return desiredTitle;

  const siblings = await tx.query.videos.findMany({
    where: and(eq(videos.lessonId, lessonId), eq(videos.archived, false)),
    columns: { id: true, title: true },
  });

  const taken = new Set(
    siblings.filter((v) => v.id !== excludeVideoId).map((v) => v.title)
  );

  if (!taken.has(desiredTitle)) return desiredTitle;

  let suffix = 2;
  while (taken.has(`${desiredTitle} (${suffix})`)) suffix++;
  return `${desiredTitle} (${suffix})`;
};

export const copyVideoImpl = (
  db: Database,
  opts: {
    sourceVideoId: string;
    newTitle: string;
    copyClips: boolean;
    copyBeats: boolean;
    copyScript: boolean;
    renameOld: boolean;
  }
): Effect.Effect<string, NotFoundError | UnknownDBServiceError> =>
  Effect.gen(function* () {
    const {
      sourceVideoId,
      newTitle,
      copyClips,
      copyBeats,
      copyScript,
      renameOld,
    } = opts;

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

        // Rename the source before inserting: the new video normally reuses the
        // source's exact title, and video_lesson_title_uniq — unique on
        // (lesson_id, title) for non-archived rows — rejects the insert while
        // the old row still holds that title.
        if (renameOld) {
          const oldTitle = await freeTitleInLesson(
            tx,
            sourceVideo.lessonId,
            `${sourceVideo.title} (old)`,
            sourceVideoId
          );

          await tx
            .update(videos)
            .set({ title: oldTitle, updatedAt: now })
            .where(eq(videos.id, sourceVideoId));
        }

        // Insert new video row
        const newVideoRows = await tx
          .insert(videos)
          .values({
            title: newTitle.trim(),
            originalFootagePath: sourceVideo.originalFootagePath,
            lessonId: sourceVideo.lessonId,
            pitchId: sourceVideo.pitchId,
            format: sourceVideo.format,
            script: copyScript ? sourceVideo.script : null,
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
                zoomType: clip.zoomType,
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

        // Clip Mockups and their Clip Mockup Chapters always come along.
        // Unlike clips, beats and the script they have no opt-out: a Video
        // duplicate is a new take on the same plan, and #1646 asks for them
        // unconditionally.
        //
        // NOTE: orders are REGENERATED here, the way this function regenerates
        // clip, chapter and beat orders. The two tables share ONE order space —
        // the Animatic — so the keys are generated across the MERGED list and
        // handed back to each row IN PLACE. A key run per table would pile
        // every Chapter at one end of the copy.
        const sourceClipMockups = await tx.query.clipMockups.findMany({
          where: and(
            eq(clipMockups.videoId, sourceVideoId),
            eq(clipMockups.archived, false)
          ),
          orderBy: asc(clipMockups.order),
        });

        const sourceClipMockupChapters =
          await tx.query.clipMockupChapters.findMany({
            where: and(
              eq(clipMockupChapters.videoId, sourceVideoId),
              eq(clipMockupChapters.archived, false)
            ),
            orderBy: asc(clipMockupChapters.order),
          });

        const animatic = sortByOrder([
          ...sourceClipMockups.map((clipMockup) => ({
            kind: "clipMockup" as const,
            order: clipMockup.order,
            clipMockup,
          })),
          ...sourceClipMockupChapters.map((chapter) => ({
            kind: "clipMockupChapter" as const,
            order: chapter.order,
            chapter,
          })),
        ]);

        if (animatic.length > 0) {
          const animaticOrders = generateNKeysBetween(
            null,
            null,
            animatic.length
          );
          const clipMockupValues: (typeof clipMockups.$inferInsert)[] = [];
          const chapterValues: (typeof clipMockupChapters.$inferInsert)[] = [];

          animatic.forEach((item, i) => {
            const order = animaticOrders[i]!;
            if (item.kind === "clipMockup") {
              clipMockupValues.push({
                videoId: newVideo.id,
                line: item.clipMockup.line,
                imagePath: item.clipMockup.imagePath,
                audioPath: item.clipMockup.audioPath,
                durationSeconds: item.clipMockup.durationSeconds,
                order,
              });
            } else {
              chapterValues.push({
                videoId: newVideo.id,
                name: item.chapter.name,
                order,
              });
            }
          });

          if (clipMockupValues.length > 0) {
            await tx.insert(clipMockups).values(clipMockupValues);
          }
          if (chapterValues.length > 0) {
            await tx.insert(clipMockupChapters).values(chapterValues);
          }
        }

        return newVideo.id;
      })
    );

    return newVideoId;
  });
