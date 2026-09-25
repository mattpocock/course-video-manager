import { compareOrderStrings } from "@/lib/sort-by-order";
import { ANIMATIC_FPS, type AnimaticSegment } from "./animatic-timeline";

/**
 * How the Animatic's sidebar is grouped into Clip Mockup Chapters.
 *
 * A Clip Mockup Chapter is a DIVIDER, never a segment. It holds no frame and
 * no speech of its own, so nothing here touches the clock in
 * `animatic-timeline.ts`: the frame count, the total run time and the `14 / 61`
 * position badge are the same numbers with Chapters as without them. This
 * module only decides which rows sit under which title, and what the title says
 * about them.
 *
 * MEMBERSHIP IS IMPLICIT. The two nouns share one fractional order space, so a
 * Clip Mockup belongs to the last Chapter ABOVE it in that merged order. There
 * is no parent column to read, which is why the grouping is arithmetic over the
 * `order` keys and lives here — pure, beside the clock, tested with rows in and
 * groups out.
 */

/** One Clip Mockup Chapter as the sidebar needs it: its title and its place. */
export interface AnimaticChapter {
  readonly id: string;
  readonly name: string;
  /** Its key in the order space it shares with the Clip Mockups. */
  readonly order: string;
}

/** One Clip Mockup row of the sidebar, with the index the player speaks in. */
export interface AnimaticChapterRow {
  readonly segment: AnimaticSegment;
  /**
   * The row's index in `AnimaticTimeline.segments` — what the highlight, the
   * ARROW keys and a seek all use. It counts Clip Mockups only, so a divider
   * never shifts it.
   */
  readonly index: number;
}

/** A Chapter, and the Clip Mockups that fall under it. */
export interface AnimaticChapterSection {
  readonly chapter: AnimaticChapter;
  readonly rows: readonly AnimaticChapterRow[];
  /** Rolled-up count of the rows under this title. Zero for an empty Chapter. */
  readonly mockupCount: number;
  /**
   * Rolled-up run time of those rows, in seconds — read off the frames, so the
   * Chapters' run times add up to the frame count the player really plays.
   */
  readonly runTimeSeconds: number;
  /** The frame the title seeks to, or `null` when the Chapter holds nothing. */
  readonly seekFrame: number | null;
  /** The index that seek selects, or `null` when the Chapter holds nothing. */
  readonly seekIndex: number | null;
}

export interface AnimaticChapterLayout {
  /**
   * The Clip Mockups above the first divider. They are PLAIN ROWS: a Video
   * whose author has not divided the top of it gets no invented heading, and a
   * Video with no Chapters at all is this list and nothing else — exactly the
   * sidebar it had before Chapters existed.
   */
  readonly leadingRows: readonly AnimaticChapterRow[];
  readonly sections: readonly AnimaticChapterSection[];
}

/**
 * Group the timeline's segments under the Video's Chapters.
 *
 * Both inputs are read in the shared order space with `compareOrderStrings`,
 * never `localeCompare`: the column is `COLLATE "C"` and a locale sort would
 * disagree with the database about which row is above which divider.
 *
 * `segments` arrive in Animatic order, as `buildAnimaticTimeline` returns them.
 */
export function buildAnimaticChapterLayout(params: {
  readonly segments: readonly AnimaticSegment[];
  readonly chapters: readonly AnimaticChapter[];
}): AnimaticChapterLayout {
  const chapters = [...params.chapters].sort((a, b) =>
    compareOrderStrings(a.order, b.order)
  );

  const leadingRows: AnimaticChapterRow[] = [];
  const grouped = chapters.map((chapter) => ({
    chapter,
    rows: [] as AnimaticChapterRow[],
  }));

  // One walk down both ordered lists. `passed` is the last divider the walk is
  // below, so a row above every divider — or a Video with no divider at all —
  // falls out as leading rather than needing a case of its own.
  let passed = -1;
  for (const [index, segment] of params.segments.entries()) {
    while (
      passed + 1 < grouped.length &&
      compareOrderStrings(
        grouped[passed + 1]!.chapter.order,
        segment.mockup.order
      ) < 0
    ) {
      passed++;
    }
    const owner = grouped[passed];
    (owner ? owner.rows : leadingRows).push({ segment, index });
  }

  return {
    leadingRows,
    sections: grouped.map((group) => rollUp(group.chapter, group.rows)),
  };
}

/** A Chapter's own line in the sidebar: how many rows, and how long they run. */
function rollUp(
  chapter: AnimaticChapter,
  rows: readonly AnimaticChapterRow[]
): AnimaticChapterSection {
  const first = rows[0];
  const frames = rows.reduce(
    (total, row) => total + row.segment.durationInFrames,
    0
  );

  return {
    chapter,
    rows,
    mockupCount: rows.length,
    runTimeSeconds: frames / ANIMATIC_FPS,
    // An empty Chapter has nowhere to send the playhead, so it does not move
    // it. Seeking to the next Chapter's first frame would lie about what the
    // author clicked.
    seekFrame: first ? first.segment.startFrame : null,
    seekIndex: first ? first.index : null,
  };
}
