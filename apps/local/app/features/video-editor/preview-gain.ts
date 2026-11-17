import { EXPORT_LOUDNESS_LUFS } from "@/lib/export-loudness";
import { isImportedFootage } from "@/packages/storage/client";
import { PREVIEW_AUDIO_BOOST_DB } from "./constants";

/**
 * The gain (in dB) the editor's preview adds to one Footage file (#2719):
 * what lifts its measured integrated loudness to the export's
 * {@link EXPORT_LOUDNESS_LUFS}, so the preview plays near what ships. Never
 * below 0, since the preview never turns audio down, and never above
 * {@link PREVIEW_AUDIO_BOOST_DB}.
 *
 * `measuredLufs` is null until the file is measured (or when it could not
 * be). Until then Footage CVM filmed (the CVM recorder's mic, OBS) is
 * assumed quiet and gets the full boost, and Imported Footage, mixed
 * elsewhere, gets none.
 */
export const previewGainDb = (input: {
  readonly measuredLufs: number | null;
  readonly imported: boolean;
}): number => {
  if (input.measuredLufs === null) {
    return input.imported ? 0 : PREVIEW_AUDIO_BOOST_DB;
  }
  const gain = EXPORT_LOUDNESS_LUFS - input.measuredLufs;
  return Math.min(PREVIEW_AUDIO_BOOST_DB, Math.max(0, gain));
};

/**
 * One Clip's preview gain: the loader's, by Clip id, or — for a Clip added
 * since the editor loaded — {@link previewGainDb}'s unmeasured answer for the
 * file it plays (`clipPlaybackFile`, as stored).
 */
export const clipPreviewGainDb = (
  gainDbByClipId: Readonly<Record<string, number>>,
  clipId: string,
  playbackFile: string
): number =>
  gainDbByClipId[clipId] ??
  previewGainDb({
    measuredLufs: null,
    imported: isImportedFootage(playbackFile),
  });
