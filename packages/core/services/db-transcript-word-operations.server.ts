import type { Database } from "./drizzle-service.server.js";
import { clipTranscriptWords } from "../db/schema.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { requireDraftVersionForClip } from "./draft-guard.server.js";

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
 * Transcript Word read/write operations, merged into `ClipOperationsService`'s
 * single surface by db-clip-operations.server.ts (the same treatment Chapters
 * get) — split into its own module only to stay under the per-file token
 * budget.
 *
 * A Transcript Word is never edited in place: a transcription produces the
 * whole set for a Clip at once, so the only write is
 * `replaceTranscriptWords`, whose result is exactly what a later
 * `listTranscriptWords` returns.
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

  return { listTranscriptWords, replaceTranscriptWords };
};
