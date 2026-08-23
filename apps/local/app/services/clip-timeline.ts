import {
  clipExportDurationInSeconds,
  paddedClipDurationsInSeconds,
} from "@/services/export-duration-check";

/**
 * The flattened Video timeline: where each Clip starts and ends once the
 * export has concatenated them end to end.
 *
 * Every write guard that asks "what else is on screen here?" needs this same
 * arithmetic — the Overlay overlap check and the Clip-Zoom-under-a-Transform
 * check both do — and two hand-rolled copies of it are two guards that can
 * quietly disagree about where an Overlay lands. It is derived from the export
 * step's own duration helpers rather than recomputed, so a guard and the
 * composited output cannot disagree either.
 */

/** A Clip as the timeline sees it: what it contributes to the flattened Video. */
export type TimelineClip = {
  id: string;
  sourceStartTime: number;
  sourceEndTime: number;
  pauseType: string | null;
};

/** One Clip's span on the flattened timeline, in seconds from the Video's start. */
export type ClipTimelineSpan<TClip extends TimelineClip> = {
  readonly clip: TClip;
  readonly from: number;
  readonly to: number;
};

/**
 * Each Clip's span on the flattened Video timeline, in the order given.
 *
 * The export concatenates the Clips end to end, so a Clip's start is the sum of
 * what every preceding Clip contributes — a Pause Clip's padded length
 * included.
 */
export const clipTimelineSpans = <TClip extends TimelineClip>(
  clips: ReadonlyArray<TClip>
): ReadonlyArray<ClipTimelineSpan<TClip>> => {
  const durations = paddedClipDurationsInSeconds(clips);
  let cursor = 0;
  return clips.map((clip, index) => {
    const from = cursor;
    const duration = durations[index];
    cursor += duration ? clipExportDurationInSeconds(duration) : 0;
    return { clip, from, to: cursor };
  });
};

/** Where each Clip starts on the flattened timeline, keyed by Clip id. */
export const clipTimelineStarts = (
  clips: ReadonlyArray<TimelineClip>
): Map<string, number> =>
  new Map(clipTimelineSpans(clips).map((span) => [span.clip.id, span.from]));
