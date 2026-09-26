/**
 * THE PLACEHOLDER FLOOR, as the publish page holds it.
 *
 * The page's half of the floor: where the author's chosen band is remembered,
 * what each position promises in words, and how the three **Lesson Publish
 * Status** counts read as one line. The verdicts themselves are never decided
 * here — they arrive from `collectLessonPublishStatuses`, the same walk that
 * builds the manifest — so this module only ever names what that walk found.
 *
 * The four positions are spelled as BANDS (`none`, `p1`, `p2`, `p3`), the same
 * spellings `cvm course publish --placeholders` accepts, because a band is a
 * stable thing to keep in `localStorage` and because the page and the CLI must
 * mean one thing by "p2". The vocabulary itself lives beside `PlaceholderFloor`
 * in the course-json package — one mapping, read by both surfaces.
 */

import type {
  LessonHardGap,
  PlaceholderFloorBand,
} from "@/packages/course-json/client";
import type { WithheldReason } from "@/services/course-publish-lesson-statuses";

/**
 * The floor is remembered PER COURSE: an unlaunched Course announcing its P2s
 * and a shipped Course announcing nothing must never share one setting, so the
 * Course id is in the key rather than in the value.
 */
export const placeholderFloorStorageKey = (courseId: string): string =>
  `publish.placeholderFloor.${courseId}`;

/** What each position of the control says on its button. */
export const PLACEHOLDER_FLOOR_BAND_LABELS: Record<
  PlaceholderFloorBand,
  string
> = {
  none: "Announce nothing",
  p1: "P1",
  p2: "P2",
  p3: "P3",
};

/**
 * What choosing this position does, in the author's own terms. The default
 * position deliberately describes itself as today's behaviour, because that is
 * the reassurance an author needs before touching a new control at all.
 */
export const PLACEHOLDER_FLOOR_BAND_DESCRIPTIONS: Record<
  PlaceholderFloorBand,
  string
> = {
  none: "This release announces nothing it cannot ship in full — exactly as a publish behaved before placeholder lessons existed. An unfinished lesson is withheld.",
  p1: "Every unfinished P1 lesson ships as a placeholder lesson — its title only, no video, no body. P2 and P3 lessons stay withheld.",
  p2: "Every unfinished P1 and P2 lesson ships as a placeholder lesson — its title only, no video, no body. P3 lessons stay withheld.",
  p3: "Every unfinished lesson ships as a placeholder lesson — its title only, no video, no body. The whole shape of the course is announced.",
};

/** Why a withheld Lesson is absent, said in one short phrase per Lesson. */
export const WITHHELD_REASON_LABELS: Record<WithheldReason, string> = {
  "no-videos":
    "no video yet — raise the floor to its priority band to announce it",
  "no-clips": "its video has no clips yet — raise the floor to announce it",
  "no-body": "its video has no body yet — raise the floor to announce it",
  todo: "still marked to-do, and to-do lessons are withheld",
};

/** Each hard gap, in the author's words. */
const HARD_GAP_LABELS: Record<LessonHardGap, string> = {
  "no-active-video": "no video",
  "no-clips": "no clips",
  "no-body": "no body",
};

/**
 * WHAT IS ACTUALLY WRONG WITH A WITHHELD LESSON, whatever its reason says.
 *
 * The reason names the control that withheld the Lesson, and when that control
 * is the to-do toggle the reason says nothing about the Lesson's hard gaps — so
 * on its own it would invite the author to mark the Lesson done, republish, and
 * watch it stay away. The gaps travel on every verdict, so they are shown
 * beside the reason: a Lesson can never look one toggle from shipping when it
 * is not. Empty for a Lesson the toggle alone is holding back, which is exactly
 * the case where flipping it IS the fix.
 */
export const formatHardGaps = (
  hardGaps: readonly LessonHardGap[]
): string | null =>
  hardGaps.length === 0
    ? null
    : hardGaps.map((gap) => HARD_GAP_LABELS[gap]).join(", ");

export type PublishSummaryCounts = {
  readonly ships: number;
  readonly placeholders: number;
  readonly withheld: number;
};

/**
 * The one live summary line. Every lesson in the version tree is in exactly one
 * of the three counts, so the line reads as a whole rather than as three
 * unrelated numbers.
 */
export const formatPublishSummary = (counts: PublishSummaryCounts): string =>
  `ships ${counts.ships} · placeholders ${counts.placeholders} · withheld ${counts.withheld}`;
