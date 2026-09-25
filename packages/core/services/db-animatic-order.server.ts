import type { Database } from "./drizzle-service.server.js";
import { clipMockupChapters, clipMockups } from "../db/schema.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { compareOrderStrings } from "../lib/sort-by-order.js";

/**
 * THE ONE SHARED POSITIONING READ of a Video's Animatic: its Clip Mockups and
 * its Clip Mockup Chapters as a single list, sorted by the fractional `order`
 * key the two nouns share.
 *
 * It lives in its own module because every path that computes a position needs
 * exactly this list and they must all agree on it: creating a Clip Mockup,
 * moving a Clip Mockup, creating a Clip Mockup Chapter, moving a Clip Mockup
 * Chapter, and the CLI's `--before`/`--after` anchor resolvers. A second answer
 * to "what is after row 14" is a row that lands on the wrong side of a divider.
 *
 * IT IS NOT THE ONLY MERGE, and it is not meant to be. It hands back
 * `{ type, id, order }` alone, so the two callers that PRINT rows read both
 * tables and merge them for themselves — the Animatic page's loader
 * (`_app.videos.$videoId.animatic.tsx`, whose sidebar prints a Chapter's title)
 * and `cvm clip-mockup list --with-chapters` (`cli/commands/animatic-rows.ts`,
 * whose stream carries the whole row of each kind). So: one shared positioning
 * read, plus two row-level merges.
 *
 * WHAT ALL THREE MUST KEEP THE SAME — the sort and the archive filters. The
 * sort is `compareOrderStrings`, never `localeCompare`, because the columns are
 * `COLLATE "C"`. The filters are TWO, one per table: a merged list built from
 * two tables has two ways to leave a deleted row in. A change to either rule
 * here is a change in all three places, or the sidebar and the CLI report an
 * order the writers did not compute.
 *
 * Why the merge matters: membership is implicit. A Clip Mockup belongs to the
 * last Chapter above it in THIS list, so a key computed against one table
 * alone puts an appended row after every divider instead of inside the last
 * one.
 */

/**
 * One row of a Video's Animatic, of either kind. Only the three facts
 * positioning needs — the type discriminator, the id an anchor names, and the
 * order key. Deliberately not the row itself: a caller that wants the line or
 * the title reads the owning table.
 */
export interface AnimaticOrderItem {
  readonly type: "clipMockup" | "clipMockupChapter";
  readonly id: string;
  readonly order: string;
}

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Read a Video's Animatic as one ordered list of both kinds of row.
 *
 * Archived rows of either kind are excluded — archived means deleted for both
 * nouns, and a deleted divider must not hold a position. The sort is the BYTE
 * comparison `compareOrderStrings` does, never `localeCompare`: the column is
 * `COLLATE "C"`, and a locale sort would disagree with the database.
 */
export const listAnimaticOrder = Effect.fn("listAnimaticOrder")(function* (
  db: Database,
  videoId: string
) {
  const mockups = yield* makeDbCall(() =>
    db.query.clipMockups.findMany({
      where: and(
        eq(clipMockups.videoId, videoId),
        eq(clipMockups.archived, false)
      ),
      orderBy: asc(clipMockups.order),
    })
  );
  const chapters = yield* makeDbCall(() =>
    db.query.clipMockupChapters.findMany({
      where: and(
        eq(clipMockupChapters.videoId, videoId),
        eq(clipMockupChapters.archived, false)
      ),
      orderBy: asc(clipMockupChapters.order),
    })
  );

  const items: AnimaticOrderItem[] = [
    ...mockups.map((row) => ({
      type: "clipMockup" as const,
      id: row.id,
      order: row.order,
    })),
    ...chapters.map((row) => ({
      type: "clipMockupChapter" as const,
      id: row.id,
      order: row.order,
    })),
  ];

  return items.sort((a, b) => compareOrderStrings(a.order, b.order));
});
