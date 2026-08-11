import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { clips, chapters, clipWebLinks } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import {
  requireDraftVersionForClip,
  requireDraftVersionForClipWebLink,
  requireDraftVersionForVideo,
} from "./draft-guard.server.js";
import { transactionalizeWrites } from "./with-db-transaction.server.js";
import { compareOrderStrings } from "../lib/sort-by-order.js";
import {
  checkClipZoomEligibility,
  clipZoomIneligibilityMessage,
} from "../features/videos/clip-zoom.js";
import { ClipNotZoomableError } from "./db-service-errors.js";
import { createChapterOperationsUnwrapped } from "./db-chapter-operations.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

const createClipOperationsUnwrapped = (db: Database) => {
  const getClipById = Effect.fn("getClipById")(function* (clipId: string) {
    const clip = yield* makeDbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, clipId),
      })
    );

    if (!clip) {
      return yield* new NotFoundError({
        type: "getClipById",
        params: { clipId },
      });
    }

    return clip;
  });

  const getClipsByIds = Effect.fn("getClipsByIds")(function* (
    clipIds: readonly string[]
  ) {
    const foundClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: inArray(clips.id, clipIds),
      })
    );

    return foundClips;
  });

  const updateClip = Effect.fn("updateClip")(function* (
    clipId: string,
    updatedClip: {
      text?: string;
      scene?: string;
      profile?: string;
      transcribedAt?: Date;
      pauseType?: string;
      sourceStartTime?: number;
      sourceEndTime?: number;
    }
  ) {
    yield* requireDraftVersionForClip(db, clipId);
    const [clip] = yield* makeDbCall(() =>
      db.update(clips).set(updatedClip).where(eq(clips.id, clipId)).returning()
    );

    return clip!;
  });

  /**
   * Set a Clip's Clip Zoom.
   *
   * A dedicated operation rather than another optional field on `updateClip`,
   * because the write carries a rule `updateClip` has no business knowing:
   * a zoom is legal only on a camera scene. Enforcing it here means the CLI
   * and any future caller inherit the rule instead of reimplementing it.
   */
  const setClipZoom = Effect.fn("setClipZoom")(function* (
    clipId: string,
    zoomType: string
  ) {
    const clip = yield* getClipById(clipId);

    const ineligibility = checkClipZoomEligibility(clip.scene);
    if (ineligibility) {
      return yield* new ClipNotZoomableError({
        clipId,
        scene: clip.scene ?? null,
        message: clipZoomIneligibilityMessage(ineligibility),
      });
    }

    yield* requireDraftVersionForClip(db, clipId);
    const [updated] = yield* makeDbCall(() =>
      db.update(clips).set({ zoomType }).where(eq(clips.id, clipId)).returning()
    );

    return updated!;
  });

  const archiveClip = Effect.fn("archiveClip")(function* (clipId: string) {
    yield* requireDraftVersionForClip(db, clipId);
    const clipExists = yield* makeDbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, clipId),
      })
    );

    if (!clipExists) {
      return yield* new NotFoundError({
        type: "archiveClip",
        params: { clipId },
      });
    }

    const clip = yield* makeDbCall(() =>
      db.update(clips).set({ archived: true }).where(eq(clips.id, clipId))
    );

    return clip;
  });

  const reorderClip = Effect.fn("reorderClip")(function* (
    clipId: string,
    direction: "up" | "down"
  ) {
    yield* requireDraftVersionForClip(db, clipId);
    // First, get the clip to know what video we're working with
    const clip = yield* makeDbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, clipId),
      })
    );

    if (!clip) {
      return yield* new NotFoundError({
        type: "reorderClip",
        params: { clipId },
      });
    }

    // Get all non-archived clips and chapters for this video
    // We need both because clips and chapters share the same ordering space
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, clip.videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );

    const allChapters = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(
          eq(chapters.videoId, clip.videoId),
          eq(chapters.archived, false)
        ),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order - clips and chapters share the same ordering space
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allChapters.map((cs) => ({
        type: "chapter" as const,
        ...cs,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));

    const itemIndex = allItems.findIndex(
      (item) => item.type === "clip" && item.id === clipId
    );
    const targetIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;

    // Check boundaries
    if (targetIndex < 0 || targetIndex >= allItems.length) {
      return { success: false, reason: "boundary" };
    }

    // Calculate new order based on neighbors in the combined list
    let newOrder: string;
    if (direction === "up") {
      const prevItem = allItems[targetIndex - 1];
      const nextItem = allItems[targetIndex];
      const prevOrder = prevItem?.order ?? null;
      const nextOrder = nextItem!.order;
      const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
      newOrder = order!;
    } else {
      const prevItem = allItems[targetIndex];
      const nextItem = allItems[targetIndex + 1];
      const prevOrder = prevItem!.order;
      const nextOrder = nextItem?.order ?? null;
      const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
      newOrder = order!;
    }

    yield* makeDbCall(() =>
      db.update(clips).set({ order: newOrder }).where(eq(clips.id, clipId))
    );

    return { success: true };
  });

  /**
   * Non-archived clips and chapters of a Video, merged and sorted by the
   * shared fractional `order` key. Clips and Chapters share one ordering
   * space (see `app/cli/commands/clip.ts` docstring), so any positioning
   * logic — reordering a clip, inserting a chapter — has to reason about
   * both together; this is the one place that assembles the merged view.
   */
  const listTimelineOrder = Effect.fn("listTimelineOrder")(function* (
    videoId: string
  ) {
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );

    const allChapters = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
        orderBy: asc(chapters.order),
      })
    );

    return [
      ...allClips.map((c) => ({
        type: "clip" as const,
        id: c.id,
        order: c.order,
      })),
      ...allChapters.map((c) => ({
        type: "chapter" as const,
        id: c.id,
        order: c.order,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));
  });

  /**
   * Reposition a Clip to an explicit point in its Video's timeline order,
   * anchored immediately before `beforeItemId` (a Clip OR Chapter id, since
   * they share one order space) — `null` appends to the end.
   *
   * Unlike `reorderClip` (nudge one slot up/down), this jumps straight to an
   * arbitrary position. The CLI's `clip move --before/--after` resolves its
   * target id against `listTimelineOrder` and hands the result here.
   */
  const moveClipToPosition = Effect.fn("moveClipToPosition")(function* (
    clipId: string,
    beforeItemId: string | null
  ) {
    yield* requireDraftVersionForClip(db, clipId);
    const clip = yield* getClipById(clipId);

    const items = (yield* listTimelineOrder(clip.videoId)).filter(
      (item) => item.id !== clipId
    );

    let prevOrder: string | null;
    let nextOrder: string | null;
    if (beforeItemId === null) {
      prevOrder = items.at(-1)?.order ?? null;
      nextOrder = null;
    } else {
      const idx = items.findIndex((item) => item.id === beforeItemId);
      if (idx === -1) {
        return yield* new NotFoundError({
          type: "moveClipToPosition",
          params: { clipId: beforeItemId },
        });
      }
      prevOrder = items[idx - 1]?.order ?? null;
      nextOrder = items[idx]!.order;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    yield* makeDbCall(() =>
      db.update(clips).set({ order: order! }).where(eq(clips.id, clipId))
    );

    return yield* getClipById(clipId);
  });

  const chapterOps = createChapterOperationsUnwrapped(db);

  const appendClips = Effect.fn("addClips")(function* (opts: {
    videoId: string;
    insertionPoint:
      | { type: "start" }
      | { type: "after-clip"; databaseClipId: string }
      | { type: "after-chapter"; chapterId: string };
    clips: readonly {
      inputVideo: string;
      startTime: number;
      endTime: number;
    }[];
  }) {
    const { videoId, insertionPoint, clips: inputClips } = opts;
    yield* requireDraftVersionForVideo(db, videoId);
    let prevOrder: string | null | undefined = null;
    let nextOrder: string | null | undefined = null;

    // Get all non-archived clips and chapters for this video
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );

    const allChapters = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order to get correct insertion position
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allChapters.map((cs) => ({
        type: "chapter" as const,
        ...cs,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));

    if (insertionPoint.type === "start") {
      // Insert before all items
      prevOrder = null;
      const firstItem = allItems[0];
      nextOrder = firstItem?.order;
    } else if (insertionPoint.type === "after-clip") {
      // Insert after specific clip, but before any section that follows it
      const insertAfterClipIndex = allItems.findIndex(
        (item) =>
          item.type === "clip" && item.id === insertionPoint.databaseClipId
      );

      if (insertAfterClipIndex === -1) {
        return yield* new NotFoundError({
          type: "appendClips",
          params: { videoId, insertionPoint },
          message: `Could not find a clip to insert after`,
        });
      }

      const insertAfterItem = allItems[insertAfterClipIndex];
      prevOrder = insertAfterItem?.order;

      // Get the next item (could be a clip OR a section)
      const nextItem = allItems[insertAfterClipIndex + 1];
      nextOrder = nextItem?.order;
    } else if (insertionPoint.type === "after-chapter") {
      // Insert after specific chapter
      const insertAfterSectionIndex = allItems.findIndex(
        (item) =>
          item.type === "chapter" && item.id === insertionPoint.chapterId
      );

      if (insertAfterSectionIndex === -1) {
        return yield* new NotFoundError({
          type: "appendClips",
          params: { videoId, insertionPoint },
          message: `Could not find a chapter to insert after`,
        });
      }

      const insertAfterItem = allItems[insertAfterSectionIndex];
      prevOrder = insertAfterItem?.order;

      const nextItem = allItems[insertAfterSectionIndex + 1];
      nextOrder = nextItem?.order;
    }

    const orders = generateNKeysBetween(
      prevOrder ?? null,
      nextOrder ?? null,
      inputClips.length
    );

    const clipsResult = yield* makeDbCall(() =>
      db
        .insert(clips)
        .values(
          inputClips.map((clip, index) => ({
            ...clip,
            videoId,
            videoFilename: clip.inputVideo,
            sourceStartTime: clip.startTime,
            sourceEndTime: clip.endTime,
            order: orders[index]!,
            archived: false,
            text: "",
          }))
        )
        .returning()
    );

    return clipsResult;
  });

  const createClipWebLinks = Effect.fn("createClipWebLinks")(function* (
    clipId: string,
    links: readonly {
      url: string;
      title: string | null;
      capturedAt: number;
    }[]
  ) {
    if (links.length === 0) return [];
    yield* requireDraftVersionForClip(db, clipId);

    const inserted = yield* makeDbCall(() =>
      db
        .insert(clipWebLinks)
        .values(
          links.map((link) => ({
            clipId,
            url: link.url,
            title: link.title,
            capturedAt: new Date(link.capturedAt),
          }))
        )
        .returning()
    );

    return inserted;
  });

  const deleteClipWebLink = Effect.fn("deleteClipWebLink")(function* (
    linkId: string
  ) {
    yield* requireDraftVersionForClipWebLink(db, linkId);
    yield* makeDbCall(() =>
      db.delete(clipWebLinks).where(eq(clipWebLinks.id, linkId))
    );
    return { success: true };
  });

  return {
    getClipById,
    getClipsByIds,
    updateClip,
    setClipZoom,
    archiveClip,
    reorderClip,
    listTimelineOrder,
    moveClipToPosition,
    ...chapterOps,
    appendClips,
    createClipWebLinks,
    deleteClipWebLink,
  };
};

/** Each write runs in one txn with its draft-guard's version-row lock (#1403). */
export const createClipOperations = (db: Database) =>
  transactionalizeWrites(db, createClipOperationsUnwrapped, [
    "updateClip",
    "setClipZoom",
    "archiveClip",
    "reorderClip",
    "moveClipToPosition",
    "createChapter",
    "createChapterAtInsertionPoint",
    "createChapterAtPosition",
    "updateChapter",
    "archiveChapter",
    "reorderChapter",
    "appendClips",
    "createClipWebLinks",
    "deleteClipWebLink",
  ]);

export class ClipOperationsService extends Effect.Service<ClipOperationsService>()(
  "ClipOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createClipOperations(db);
    }),
  }
) {}
