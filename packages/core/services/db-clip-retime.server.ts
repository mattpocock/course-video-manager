import type { Database } from "./drizzle-service.server.js";
import { clipTranscriptWords, clips, overlays } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { requireDraftVersionForClip } from "./draft-guard.server.js";
import { writeTranscriptWords } from "./db-transcript-word-operations.server.js";
import {
  retimeShift,
  shiftOverlayAnchors,
  shiftTranscriptWords,
} from "../features/videos/retime-cascade.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Retiming a Clip — merged into `ClipOperationsService`'s single surface by
 * db-clip-operations.server.ts, split out only to stay under the per-file
 * token budget.
 *
 * A dedicated operation rather than two more optional fields on `updateClip`,
 * for the same reason `setClipZoom` is one: the write carries a rule
 * `updateClip` has no business knowing. Moving a Clip's in-point moves the
 * footage out from under every Clip-relative offset stored against it, so the
 * recut is never just an UPDATE of two columns — it is that UPDATE plus the
 * cascade over the Clip's Transcript Words and Overlays, and the two must not
 * be separable. Anyone who retimes through this method inherits the cascade
 * instead of reimplementing it (or, far more likely, forgetting it).
 *
 * The whole thing runs in ONE transaction, under the draft guard's version-row
 * lock, because a half-applied cascade is a Clip whose words point at footage
 * it no longer contains — exactly the state the cascade exists to prevent.
 *
 * The arithmetic itself is pure and lives in
 * features/videos/retime-cascade.ts; this module is the plumbing that reads
 * the rows, hands them over, and writes back what comes out.
 */
export const createClipRetimeOperationsUnwrapped = (db: Database) => {
  /**
   * Recut a Clip, carrying its Transcript Words and Overlays with it.
   *
   * Both ends are required: a caller that only wants to move one end passes
   * the other end's current value, which it must have read anyway to validate
   * the range. That keeps "what the new cut is" a single unambiguous fact
   * here, rather than something reconstructed from a patch.
   */
  const retimeClip = Effect.fn("retimeClip")(function* (
    clipId: string,
    range: { sourceStartTime: number; sourceEndTime: number }
  ) {
    yield* requireDraftVersionForClip(db, clipId);

    // Read the OLD cut before overwriting it — the delta is the difference
    // between the two, and there is nowhere else to recover it from once the
    // row is updated.
    const previous = yield* makeDbCall(() =>
      db.query.clips.findFirst({ where: eq(clips.id, clipId) })
    );
    if (!previous) {
      return yield* new NotFoundError({
        type: "retimeClip",
        params: { clipId },
      });
    }

    const shift = retimeShift(previous, range);

    const [updated] = yield* makeDbCall(() =>
      db.update(clips).set(range).where(eq(clips.id, clipId)).returning()
    );

    // Transcript Words: shift, and drop the ones that no longer fit. Rewritten
    // wholesale (the same delete-then-insert a transcription does) rather than
    // patched row by row — a Clip's words are one set, written at one time.
    const words = yield* makeDbCall(() =>
      db
        .select({
          start: clipTranscriptWords.start,
          end: clipTranscriptWords.end,
          text: clipTranscriptWords.text,
        })
        .from(clipTranscriptWords)
        .where(eq(clipTranscriptWords.clipId, clipId))
        .orderBy(asc(clipTranscriptWords.start))
    );
    if (words.length > 0) {
      yield* writeTranscriptWords(
        db,
        clipId,
        shiftTranscriptWords(words, shift)
      );
    }

    // Overlays: shift, and clamp the ones that no longer fit. Never deleted,
    // and only `at` is ever written — a recut cannot reach a Definition Card's
    // title or description.
    const anchored = yield* makeDbCall(() =>
      db
        .select({ id: overlays.id, at: overlays.at })
        .from(overlays)
        .where(eq(overlays.clipId, clipId))
    );
    yield* Effect.forEach(
      shiftOverlayAnchors(anchored, shift),
      (moved) =>
        makeDbCall(() =>
          db
            .update(overlays)
            .set({ at: moved.at })
            .where(eq(overlays.id, moved.id))
        ),
      { discard: true }
    );

    return updated!;
  });

  return { retimeClip };
};
