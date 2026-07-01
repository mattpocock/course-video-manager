import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";
import { segments } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import {
  DEFAULT_SEGMENT_KIND,
  type SegmentKind,
} from "@/features/segments/segment-kinds";
import { and, asc, eq } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createSegmentOperations = (db: Database) => {
  /** Non-archived segments of a video, sorted by their fractional `order` key. */
  const listSegmentsByVideoId = (videoId: string) =>
    makeDbCall(() =>
      db.query.segments.findMany({
        where: and(eq(segments.videoId, videoId), eq(segments.archived, false)),
        orderBy: asc(segments.order),
      })
    );

  /**
   * Create a Segment in the Video's plan, with the given `title` (default
   * empty), `kind` (defaulting to Definition) and free-text `description`
   * (default empty). `beforeSegmentId` anchors the new Segment immediately
   * before that one; `null`/absent appends to the end. Mirrors the
   * fractional-key positioning of {@link moveSegment}.
   */
  const createSegment = Effect.fn("createSegment")(function* (
    videoId: string,
    kind: SegmentKind = DEFAULT_SEGMENT_KIND,
    beforeSegmentId: string | null = null,
    title: string = "",
    description: string = ""
  ) {
    const existing = yield* listSegmentsByVideoId(videoId);

    let prevOrder: string | null;
    let nextOrder: string | null;
    if (beforeSegmentId === null) {
      prevOrder = existing.at(-1)?.order ?? null;
      nextOrder = null;
    } else {
      const idx = existing.findIndex((s) => s.id === beforeSegmentId);
      if (idx === -1) {
        return yield* new NotFoundError({
          type: "segment",
          params: { id: beforeSegmentId },
        });
      }
      prevOrder = existing[idx - 1]?.order ?? null;
      nextOrder = existing[idx]!.order;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    const [segment] = yield* makeDbCall(() =>
      db
        .insert(segments)
        .values({
          videoId,
          kind,
          title,
          description,
          order: order!,
        })
        .returning()
    );

    if (!segment) {
      return yield* new UnknownDBServiceError({
        cause: "No segment was returned from the database",
      });
    }

    return segment;
  });

  const requireSegment = (id: string) =>
    Effect.gen(function* () {
      const [updated] = yield* makeDbCall(() =>
        db.select().from(segments).where(eq(segments.id, id))
      );
      if (!updated) {
        return yield* new NotFoundError({ type: "segment", params: { id } });
      }
      return updated;
    });

  const renameSegment = Effect.fn("renameSegment")(function* (
    id: string,
    title: string
  ) {
    yield* makeDbCall(() =>
      db.update(segments).set({ title }).where(eq(segments.id, id))
    );
    return yield* requireSegment(id);
  });

  /**
   * Set a Segment's free-text planning Description (default `""`). Purely an
   * in-app authoring aid — never published. The Description rides on the segment
   * row, so moving a Segment between Videos preserves it automatically.
   */
  const setSegmentDescription = Effect.fn("setSegmentDescription")(function* (
    id: string,
    description: string
  ) {
    yield* makeDbCall(() =>
      db.update(segments).set({ description }).where(eq(segments.id, id))
    );
    return yield* requireSegment(id);
  });

  const setSegmentKind = Effect.fn("setSegmentKind")(function* (
    id: string,
    kind: SegmentKind
  ) {
    yield* makeDbCall(() =>
      db.update(segments).set({ kind }).where(eq(segments.id, id))
    );
    return yield* requireSegment(id);
  });

  const deleteSegment = Effect.fn("deleteSegment")(function* (id: string) {
    yield* makeDbCall(() =>
      db.update(segments).set({ archived: true }).where(eq(segments.id, id))
    );
    return { success: true as const };
  });

  /**
   * Move a Segment within its Video (reorder) or into another Video. Reassigns
   * `videoId` to the target and computes a fractional key strictly between the
   * drop neighbours. `beforeSegmentId === null` appends to the target's end.
   * Mirrors the cross-section lesson move shape (ADR 0011/0013).
   */
  const moveSegment = Effect.fn("moveSegment")(function* (
    segmentId: string,
    targetVideoId: string,
    beforeSegmentId: string | null
  ) {
    yield* requireSegment(segmentId);

    // The target's segments as they'd look without the moved one.
    const targetSegments = yield* listSegmentsByVideoId(targetVideoId);
    const remaining = targetSegments.filter((s) => s.id !== segmentId);

    let prevOrder: string | null;
    let nextOrder: string | null;
    if (beforeSegmentId === null) {
      prevOrder = remaining.at(-1)?.order ?? null;
      nextOrder = null;
    } else {
      const idx = remaining.findIndex((s) => s.id === beforeSegmentId);
      if (idx === -1) {
        return yield* new NotFoundError({
          type: "segment",
          params: { id: beforeSegmentId },
        });
      }
      prevOrder = remaining[idx - 1]?.order ?? null;
      nextOrder = remaining[idx]!.order;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    yield* makeDbCall(() =>
      db
        .update(segments)
        .set({ videoId: targetVideoId, order: order! })
        .where(eq(segments.id, segmentId))
    );

    return yield* requireSegment(segmentId);
  });

  return {
    listSegmentsByVideoId,
    getSegmentById: requireSegment,
    createSegment,
    renameSegment,
    setSegmentDescription,
    setSegmentKind,
    deleteSegment,
    moveSegment,
  };
};

export class SegmentOperationsService extends Effect.Service<SegmentOperationsService>()(
  "SegmentOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createSegmentOperations(db);
    }),
  }
) {}
