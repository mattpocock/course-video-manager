import { EXPORT_LOUDNESS_LUFS, PREVIEW_AUDIO_BOOST_DB } from "./constants";

/**
 * The gain (in dB) the editor's preview adds to one Footage file (#2719):
 * what lifts its measured integrated loudness to the export's
 * {@link EXPORT_LOUDNESS_LUFS}, so the preview plays near what ships. Never
 * below 0, since the preview never turns audio down, and never above
 * {@link PREVIEW_AUDIO_BOOST_DB}.
 *
 * `measuredLufs` is null until the file is measured. Until then Footage CVM
 * filmed (the CVM recorder's mic, OBS) is assumed quiet and gets the full
 * boost, and Imported Footage, mixed elsewhere, gets none.
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
