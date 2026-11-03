import type { Database } from "./drizzle-service.server.js";
import { clips, clipTranscriptWords } from "../db/schema.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { requireDraftVersionForClip } from "./draft-guard.server.js";
import { retextTranscriptWords } from "../features/videos/retext-transcript-words.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/** One spoken word, at CLIP-RELATIVE offsets in seconds (`0` = Clip start). */
export interface TranscriptWordInput {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Write a Clip's Transcript Words, replacing whatever it had.
 *
 * Kept as a plain function (not an Effect.fn method) so `createClip` can call
 * it inside its OWN transaction — a Clip created by `cvm clip add` gets its
 * words in the same write as the row itself, never as a second round trip that
 * could leave a Clip with text but no timing.
 */
export const writeTranscriptWords = (
  db: Database,
  clipId: string,
  words: ReadonlyArray<TranscriptWordInput>
) =>
  Effect.gen(function* () {
    yield* makeDbCall(() =>
      db
        .delete(clipTranscriptWords)
        .where(eq(clipTranscriptWords.clipId, clipId))
    );

    if (words.length === 0) return [];

    return yield* makeDbCall(() =>
      db
        .insert(clipTranscriptWords)
        .values(
          words.map((word) => ({
            clipId,
            start: word.start,
            end: word.end,
            text: word.text,
          }))
        )
        .returning()
    );
  });

/**
 * Edit a Clip's text by hand (#2184), rewriting its Transcript Words in the
 * same write so they never disagree with it: re-mapped onto the old timings,
 * or the old span shared out by letter count (`retextTranscriptWords`).
 * Footage, source times and the Transcription status are never touched.
 *
 * A plain function like `writeTranscriptWords`: the caller runs it inside the
 * transaction that already holds the Clip's Draft guard.
 */
export const writeClipText = (db: Database, clipId: string, text: string) =>
  Effect.gen(function* () {
    const oldWords = yield* makeDbCall(() =>
      db.query.clipTranscriptWords.findMany({
        where: eq(clipTranscriptWords.clipId, clipId),
        orderBy: [asc(clipTranscriptWords.start), asc(clipTranscriptWords.end)],
      })
    );
    const [clip] = yield* makeDbCall(() =>
      db.update(clips).set({ text }).where(eq(clips.id, clipId)).returning()
    );
    if (!clip) return undefined;
    yield* writeTranscriptWords(
      db,
      clipId,
      retextTranscriptWords(text, oldWords)
    );
    return clip;
  });

/**
 * Transcript Word read/write operations, merged into `ClipOperationsService`'s
 * single surface by db-clip-operations.server.ts (the same treatment Chapters
 * get) — split into its own module only to stay under the per-file token
 * budget.
 *
 * A Transcript Word is never edited in place: a transcription produces the
 * whole set for a Clip at once, so the only write is
 * `replaceTranscriptWords`, whose result is exactly what a later
 * `listTranscriptWords` returns (and `writeClipText`, which rewrites the whole
 * set to match a hand-edited text).
 */
export const createTranscriptWordOperationsUnwrapped = (db: Database) => {
  /**
   * A Clip's Transcript Words in spoken order. A Clip that has never been
   * transcribed simply has none — that is an empty list, not an error, because
   * "not transcribed yet" is an ordinary state of a freshly captured Clip.
   */
  const listTranscriptWords = Effect.fn("listTranscriptWords")(function* (
    clipId: string
  ) {
    return yield* makeDbCall(() =>
      db.query.clipTranscriptWords.findMany({
        where: eq(clipTranscriptWords.clipId, clipId),
        orderBy: [asc(clipTranscriptWords.start)],
      })
    );
  });

  /**
   * Replace a Clip's Transcript Words wholesale. Passing `[]` clears them.
   * Guarded by the owning version's Draft check like every other Clip write.
   */
  const replaceTranscriptWords = Effect.fn("replaceTranscriptWords")(function* (
    clipId: string,
    words: ReadonlyArray<TranscriptWordInput>
  ) {
    yield* requireDraftVersionForClip(db, clipId);
    yield* writeTranscriptWords(db, clipId, words);
    return yield* listTranscriptWords(clipId);
  });

  /**
   * Edit Transcript: set a Clip's text by hand, its Transcript Words rewritten
   * to match in the same write (`writeClipText`). `undefined` for no such Clip.
   * Guarded by the owning version's Draft check like every other Clip write.
   */
  const setClipText = Effect.fn("setClipText")(function* (
    clipId: string,
    text: string
  ) {
    yield* requireDraftVersionForClip(db, clipId);
    return yield* writeClipText(db, clipId, text);
  });

  /**
   * The live Clips of this Video that have at least one Transcript Word.
   *
   * Already-transcribed Clips are deliberately never backfilled (spec #1567),
   * so a Video edited before Transcript Words existed keeps Clips with none
   * until somebody re-transcribes it. The editor seeds its clip state with
   * these ids and decides the "missing word timing" warning itself, because
   * only it knows which Clips are being transcribed right now. Ids, not words:
   * the editor has no other use for the words.
   */
  const listClipIdsWithTranscriptWords = Effect.fn(
    "listClipIdsWithTranscriptWords"
  )(function* (videoId: string) {
    const rows = yield* makeDbCall(() =>
      db
        .selectDistinct({ id: clips.id })
        .from(clips)
        .innerJoin(
          clipTranscriptWords,
          eq(clipTranscriptWords.clipId, clips.id)
        )
        .where(and(eq(clips.videoId, videoId), eq(clips.archived, false)))
    );

    return rows.map((row) => row.id);
  });

  return {
    listTranscriptWords,
    replaceTranscriptWords,
    setClipText,
    listClipIdsWithTranscriptWords,
  };
};
