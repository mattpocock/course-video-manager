import { Effect } from "effect";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { compareOrderStrings } from "@/lib/sort-by-order";

/**
 * Read a Video's whole Animatic — its Clip Mockups AND the Clip Mockup
 * Chapters that divide them — as one stream of rows in playback order.
 *
 * `listAnimaticOrder` is deliberately NOT used here. It returns only
 * `{ type, id, order }`, which is all a positioning caller needs; this caller
 * needs the whole row of each kind. So both tables are read and merged here,
 * with `compareOrderStrings` over the ONE order key space the two nouns share.
 * The comparison is a byte comparison, matching the columns' COLLATE "C" — a
 * `localeCompare` would put the rows in a different order than the database,
 * the player and every other reader.
 *
 * Every row carries two extra fields:
 *
 * - `type`, so a reader never has to guess which kind of row it holds.
 * - `position`, 1..N over the CLIP MOCKUPS ONLY and `null` on a Chapter.
 *   The position is carried rather than counted because a Chapter row now sits
 *   in the stream: counting lines would silently yield a number one too high
 *   for every Clip Mockup below the first divider, and that wrong number is
 *   what an agent would pass back as `--at` or say out loud to the author.
 */
export const listAnimaticRows = (videoId: string) =>
  Effect.gen(function* () {
    const mockupSvc = yield* ClipMockupOperationsService;
    const chapterSvc = yield* ClipMockupChapterOperationsService;

    const mockups = yield* mockupSvc.listClipMockupsByVideoId(videoId);
    const chapters = yield* chapterSvc.listClipMockupChaptersByVideoId(videoId);

    const merged = [
      ...mockups.map((row) => ({ type: "clipMockup" as const, row })),
      ...chapters.map((row) => ({ type: "clipMockupChapter" as const, row })),
    ].sort((a, b) => compareOrderStrings(a.row.order, b.row.order));

    let position = 0;
    return merged.map((item) =>
      item.type === "clipMockup"
        ? { type: item.type, position: ++position, ...item.row }
        : { type: item.type, position: null, ...item.row }
    );
  });
