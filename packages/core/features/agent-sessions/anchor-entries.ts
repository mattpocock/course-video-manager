import { effectiveClipScene } from "../videos/effective-scene.js";
import { LONDON_TIME_ZONE, zonedToEpochMs } from "../time/london-time.js";

/**
 * Where an Agent Session Entry is stored: on a Clip, at a Footage time. An
 * entry is timed by the wall clock it was written at; the Clips are timed by
 * the wall clock their Footage started at. Anchoring joins the two.
 */

/** A live Clip of the Video, in video order, as anchoring reads it. */
export type AnchorClip = {
  readonly id: string;
  readonly videoFilename: string;
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
  readonly scene: string | null;
  readonly sceneOverride: string | null;
  /** The Recording Session's start, for a CVM-recorder Clip; else null. */
  readonly recordingSessionStartedAt: Date | null;
};

/**
 * A screen Clip shows the screen, so whatever the session printed: any
 * effective scene but Camera, including none.
 */
export const isScreenClip = (clip: {
  readonly scene: string | null;
  readonly sceneOverride: string | null;
}) => effectiveClipScene(clip) !== "Camera";

/**
 * The clock OBS named its Footage files by: the author's local time. Only an
 * OBS file's name says when it started, and the deployed API runs in UTC, so
 * the zone is stated rather than taken from the machine.
 */
export const OBS_FILENAME_TIME_ZONE = LONDON_TIME_ZONE;

/** OBS names a file at the whole second it began: take the middle of it. */
const OBS_START_WITHIN_SECOND_MS = 500;

const OBS_FILENAME =
  /(?:^|[/\\])(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.[A-Za-z0-9]+$/;

/**
 * When a Clip's Footage file started, in epoch ms, or null when nothing says:
 * a CVM-recorder Clip's Recording Session start, else an OBS file name's
 * second plus half a second.
 */
export const footageStartMs = (clip: AnchorClip): number | null => {
  if (clip.recordingSessionStartedAt) {
    return clip.recordingSessionStartedAt.getTime();
  }
  const match = OBS_FILENAME.exec(clip.videoFilename);
  if (!match) return null;
  return (
    zonedToEpochMs(match.slice(1).map(Number), OBS_FILENAME_TIME_ZONE) +
    OBS_START_WITHIN_SECOND_MS
  );
};

export type Anchored<T> = T & {
  readonly clipId: string;
  /** Seconds into the Clip's Footage file — not relative to its in-point. */
  readonly footageTime: number;
};

export type AnchorResult<T> = {
  readonly anchored: ReadonlyArray<Anchored<T>>;
  /** Written after the end of the Video's last screen Clip. */
  readonly afterLastScreenClip: number;
  /** Screen Clips skipped because nothing says when their Footage started. */
  readonly clipsWithoutFootageStart: ReadonlyArray<string>;
};

/**
 * Each entry goes to the FIRST screen Clip, in video order, whose wall-clock
 * end is after the entry's time; an entry written in Footage that was cut
 * lands on the next screen Clip, before its in-point, and shows from that
 * Clip's start. Entries after the last screen Clip are dropped.
 */
export const anchorEntries = <T extends { readonly wallClockMs: number }>(
  clipsInVideoOrder: ReadonlyArray<AnchorClip>,
  entries: ReadonlyArray<T>
): AnchorResult<T> => {
  const clipsWithoutFootageStart: string[] = [];
  const windows = clipsInVideoOrder.filter(isScreenClip).flatMap((clip) => {
    const start = footageStartMs(clip);
    if (start === null) {
      clipsWithoutFootageStart.push(clip.id);
      return [];
    }
    return [{ clip, start, wallEnd: start + clip.sourceEndTime * 1000 }];
  });

  const anchored: Anchored<T>[] = [];
  let afterLastScreenClip = 0;
  for (const entry of entries) {
    const window = windows.find((w) => w.wallEnd > entry.wallClockMs);
    if (!window) {
      afterLastScreenClip++;
      continue;
    }
    anchored.push({
      ...entry,
      clipId: window.clip.id,
      footageTime: (entry.wallClockMs - window.start) / 1000,
    });
  }
  return { anchored, afterLastScreenClip, clipsWithoutFootageStart };
};
