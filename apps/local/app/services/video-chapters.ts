import { sortByOrder } from "@/lib/sort-by-order";
import { formatDuration } from "@/lib/format-duration";
import { clipExportDurationInSeconds } from "@/services/export-duration-check";

/**
 * The chapter list of a Video: where each Chapter starts, in whole seconds
 * from the start of the Video.
 *
 * This is THE ONE place that turns Clips and Chapters into chapter timestamps.
 * The published course.json, the "Copy YouTube chapters" button and the
 * AI writer all read it, so the three can never disagree. The rules:
 *
 * - A Chapter starts at the floored sum of what the Clips above it add to the
 *   EXPORTED video: each Clip's span of source, plus the long Pause the export
 *   appends to a Clip whose Pause Type is "long" ({@link exportedClipSeconds}).
 *   So a timestamp lands where its Chapter is in the exported file.
 * - A Chapter with no Clip time below it (the next Chapter, or the end of the
 *   Video, starts at the same second) is dropped.
 * - When the first kept Chapter does not start at 0:00, an "Intro" Chapter is
 *   added at 0:00, because YouTube needs a chapter at 0:00.
 * - No Chapters kept means an empty list.
 */
export type VideoChapter = {
  title: string;
  startTime: number;
};

/**
 * One item of a Video's timeline, in timeline order. A Clip's
 * `durationSeconds` is what it adds to the exported video: build it with
 * {@link exportedClipSeconds}.
 */
export type ChapterTimelineItem =
  { kind: "clip"; durationSeconds: number } | { kind: "chapter"; name: string };

/** A Clip as the chapter list needs it: its span of source and its Pause. */
export type ChapterClip = {
  sourceStartTime: number;
  sourceEndTime: number;
  pauseType: string | null;
};

/**
 * The seconds one Clip adds to the exported video, read from the export's own
 * duration rule, so a Chapter's timestamp and the exported file cannot drift
 * apart. The final Clip's padding is left out on purpose: it trails the last
 * Clip, so it moves no Chapter, and counting it would keep a Chapter that has
 * no Clip below it.
 */
export const exportedClipSeconds = (clip: ChapterClip): number =>
  clipExportDurationInSeconds({
    duration: clip.sourceEndTime - clip.sourceStartTime,
    pauseType: clip.pauseType === "long" ? "long" : "none",
  });

/**
 * The chapter list for a timeline that is ALREADY in timeline order — the
 * video editor's items, say.
 */
export const buildVideoChapters = (
  timeline: ChapterTimelineItem[]
): VideoChapter[] => {
  let elapsed = 0;
  const raw: VideoChapter[] = [];
  for (const item of timeline) {
    if (item.kind === "clip") {
      elapsed += item.durationSeconds;
    } else {
      raw.push({ title: item.name, startTime: Math.floor(elapsed) });
    }
  }

  const totalSeconds = Math.floor(elapsed);
  const kept = raw.filter((chapter, i) => {
    const next = raw[i + 1]?.startTime ?? totalSeconds;
    return chapter.startTime < next;
  });

  if (kept.length > 0 && kept[0]!.startTime > 0) {
    kept.unshift({ title: "Intro", startTime: 0 });
  }

  return kept;
};

/**
 * The chapter list for a Video's Clip and Chapter rows as they come from the
 * database: each carries its `order`, and the two lists share one order.
 */
export const buildVideoChaptersFromRows = (
  clips: (ChapterClip & { order: string })[],
  chapters: { order: string; name: string }[]
): VideoChapter[] => {
  const timeline = sortByOrder([
    ...clips.map((clip) => ({
      order: clip.order,
      item: {
        kind: "clip",
        durationSeconds: exportedClipSeconds(clip),
      } satisfies ChapterTimelineItem,
    })),
    ...chapters.map((chapter) => ({
      order: chapter.order,
      item: {
        kind: "chapter",
        name: chapter.name,
      } satisfies ChapterTimelineItem,
    })),
  ]).map((entry): ChapterTimelineItem => entry.item);

  return buildVideoChapters(timeline);
};

/**
 * The YouTube description form of a chapter list: "M:SS" timestamps, one per
 * Chapter, e.g. `{ timestamp: "1:05", name: "Setup" }`.
 */
export type YouTubeChapter = { timestamp: string; name: string };

export const toYouTubeChapters = (chapters: VideoChapter[]): YouTubeChapter[] =>
  chapters.map((chapter) => ({
    timestamp: formatDuration(chapter.startTime),
    name: chapter.title,
  }));
