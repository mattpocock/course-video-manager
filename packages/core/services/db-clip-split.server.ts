import { and, asc, eq, gte } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import {
  agentSessionEntries,
  chapters,
  clipLayers,
  clips,
  overlays,
} from "../db/schema.js";
import {
  planClipSplit,
  splitClipLayers,
  type ClipSplitAt,
} from "../features/videos/clip-split.js";
import { layerSpecsFromRows } from "../features/videos/clip-layer.js";
import { compareOrderStrings } from "../lib/sort-by-order.js";
import {
  clipLayersRelation,
  layerRowsFromSpecs,
} from "./clip-layers-relation.js";
import { clipChildrenWith, copyClipsOntoVideo } from "./copy-child-rows.js";
import {
  ClipSplitRefusedError,
  NotFoundError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import { writeTranscriptWords } from "./db-transcript-word-operations.server.js";
import { requireDraftVersionForClip } from "./draft-guard.server.js";
import type { Database } from "./drizzle-service.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/**
 * `cvm clip split` (#2670): one Clip becomes two adjacent Clips in the same
 * Video and place, cut at a word boundary (features/videos/clip-split.ts says
 * where, and what each side keeps).
 *
 * The original keeps its id and becomes the LEFT side. The RIGHT side is a new
 * Clip right after it, made by `copyClipsOntoVideo` so every Clip column rides
 * along (Recording Session, scene, Scene Override, Clip Zoom, createdAt), with
 * its Clip Origin kept: it is the same filming, not a copy. Its Clip Web Links
 * are copied; the rows that sit at a moment move instead, keeping their ids:
 * the Overlays anchored at or after the cut, and the Agent Session Entries
 * written at or after it. The Pause is after the Clip, so it goes right.
 *
 * Runs in one transaction (createClipOperations), so a refused or failed split
 * writes nothing.
 */
export const createClipSplitOperationsUnwrapped = (db: Database) => {
  const splitClip = Effect.fn("splitClip")(function* (
    clipId: string,
    at: ClipSplitAt,
    /** Neither side may be shorter: the recorder's minimum clip length. */
    minimumSeconds = 0
  ) {
    yield* requireDraftVersionForClip(db, clipId);
    const source = yield* makeDbCall(() =>
      db.query.clips.findFirst({
        where: and(eq(clips.id, clipId), eq(clips.archived, false)),
        with: clipChildrenWith,
      })
    );
    if (!source) {
      return yield* new NotFoundError({
        type: "splitClip",
        params: { clipId },
      });
    }

    const plan = planClipSplit(source, source.transcriptWords, at, {
      minimumSeconds,
    });
    if ("problem" in plan) {
      return yield* new ClipSplitRefusedError({
        clipId,
        message: plan.problem,
      });
    }
    const layerRows = yield* makeDbCall(() =>
      db.query.clipLayers.findMany({
        where: eq(clipLayers.clipId, clipId),
        columns: clipLayersRelation.columns,
        orderBy: asc(clipLayers.position),
      })
    );
    const layers = splitClipLayers(layerSpecsFromRows(layerRows), plan.cut);
    if ("problem" in layers) {
      return yield* new ClipSplitRefusedError({
        clipId,
        message: layers.problem,
      });
    }
    const cutAt = source.sourceStartTime + plan.cut;

    // The right side goes straight after the left, before whatever came next.
    const nextOrder = yield* nextOrderAfter(source.videoId, source.order);
    const order = generateKeyBetween(source.order, nextOrder);
    const ids = yield* makeDbCall(() =>
      copyClipsOntoVideo(
        db,
        [
          {
            clip: {
              ...source,
              sourceStartTime: cutAt,
              text: plan.right.text,
              transcriptWords: [],
              overlays: [],
              layers: [],
              agentSessionEntries: [],
            },
            videoId: source.videoId,
            order,
          },
        ],
        { origin: "keep" }
      )
    );
    const rightId = ids.get(source.id)!;
    yield* writeTranscriptWords(db, rightId, plan.right.words);
    if (layers.right.length > 0) {
      yield* makeDbCall(() =>
        db.insert(clipLayers).values(layerRowsFromSpecs(rightId, layers.right))
      );
    }

    // What sits at or after the cut moves right, at the same moment of footage.
    const moving = yield* makeDbCall(() =>
      db
        .select({ id: overlays.id, at: overlays.at })
        .from(overlays)
        .where(and(eq(overlays.clipId, clipId), gte(overlays.at, plan.cut)))
    );
    yield* Effect.forEach(
      moving,
      (overlay) =>
        makeDbCall(() =>
          db
            .update(overlays)
            .set({ clipId: rightId, at: overlay.at - plan.cut })
            .where(eq(overlays.id, overlay.id))
        ),
      { discard: true }
    );
    yield* makeDbCall(() =>
      db
        .update(agentSessionEntries)
        .set({ clipId: rightId })
        .where(
          and(
            eq(agentSessionEntries.clipId, clipId),
            gte(agentSessionEntries.footageTime, cutAt)
          )
        )
    );

    // The left side: the original, cut short.
    yield* writeTranscriptWords(db, clipId, plan.left.words);
    if (layerRows.length > 0) {
      yield* makeDbCall(() =>
        db.delete(clipLayers).where(eq(clipLayers.clipId, clipId))
      );
      yield* makeDbCall(() =>
        db.insert(clipLayers).values(layerRowsFromSpecs(clipId, layers.left))
      );
    }
    const [left] = yield* makeDbCall(() =>
      db
        .update(clips)
        .set({ sourceEndTime: cutAt, text: plan.left.text, pauseType: "none" })
        .where(eq(clips.id, clipId))
        .returning()
    );
    const right = yield* makeDbCall(() =>
      db.query.clips.findFirst({ where: eq(clips.id, rightId) })
    );
    return { left: left!, right: right! };
  });

  /** The order key of the first live Clip or Chapter after `order` in a Video. */
  const nextOrderAfter = (videoId: string, order: string) =>
    makeDbCall(async () => {
      const clipRows = await db.query.clips.findMany({
        where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
        columns: { order: true },
      });
      const chapterRows = await db.query.chapters.findMany({
        where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
        columns: { order: true },
      });
      return (
        [...clipRows, ...chapterRows]
          .map((row) => row.order)
          .filter((other) => compareOrderStrings(other, order) > 0)
          .sort(compareOrderStrings)[0] ?? null
      );
    });

  return { splitClip };
};
