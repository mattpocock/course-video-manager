import {
  clipExportDurationInSeconds,
  expectedExportDurationInSeconds,
  type ExportClipDuration,
} from "./export-duration-check";

/**
 * Convert every Overlay's Clip-relative anchor into an absolute offset on the
 * finished Video's timeline.
 *
 * The export concatenates the Clips end to end, so a Clip's start on the
 * timeline is the sum of what every preceding Clip contributes — its padded
 * duration plus its long Pause, exactly the number ffmpeg is told to cut. The
 * Clips must arrive in playback order and with the archived ones already gone,
 * which is what `getVideoWithClipsById` returns and what the renderer is fed.
 *
 * An Overlay lasts as long as it says, not as long as its anchor Clip: one
 * that outlives its Clip keeps showing over the Clips that follow, and is cut
 * off at the end of the Video. An Overlay anchored past the end of the Video —
 * only reachable from data that no longer matches its Clip — is dropped rather
 * than composited into a span that does not exist.
 *
 * Every Kind is placed, a Chat Card included: this is the one placement both
 * the export and a Short's render read.
 */
export const placeOnTimeline = <
  O extends { at: number; durationInSeconds: number },
>(
  clips: ReadonlyArray<{ overlays: ReadonlyArray<O> }>,
  clipDurations: ReadonlyArray<ExportClipDuration>
): Array<{ overlay: O; startInSeconds: number; endInSeconds: number }> => {
  const videoEndInSeconds = expectedExportDurationInSeconds(clipDurations);
  const placed: Array<{
    overlay: O;
    startInSeconds: number;
    endInSeconds: number;
  }> = [];
  let clipStartInSeconds = 0;

  clips.forEach((clip, index) => {
    const duration = clipDurations[index];
    for (const overlay of clip.overlays) {
      const startInSeconds = clipStartInSeconds + overlay.at;
      const endInSeconds = Math.min(
        startInSeconds + overlay.durationInSeconds,
        videoEndInSeconds
      );
      if (!(endInSeconds > startInSeconds)) continue;
      placed.push({ overlay, startInSeconds, endInSeconds });
    }
    clipStartInSeconds += duration ? clipExportDurationInSeconds(duration) : 0;
  });

  return placed;
};
