export const FINAL_VIDEO_PADDING = 0.5 - 0.08;
export const INSERTION_POINT_ID = "insertion-point";
export const RECORDING_SESSION_PANELS_ID = "recording-session-panels";
export const BEAT_DURATION = 0.4;
/**
 * The integrated loudness (LUFS) the export's `loudnorm` brings every Video
 * to (`ffmpeg-encode-commands.ts`), and so the level the editor's preview
 * lifts each Footage file towards (`preview-gain.ts`).
 */
export const EXPORT_LOUDNESS_LUFS = -16;
/**
 * The most gain (in dB) the editor's preview adds to a Footage file, and what
 * it adds to Footage CVM filmed until that file is measured
 * (`preview-gain.ts`). Preview only: exports are normalised separately by
 * ffmpeg `loudnorm`. Lowered from 14 to 12 after the mic input level went up
 * and preview became too loud.
 */
export const PREVIEW_AUDIO_BOOST_DB = 12;
/**
 * Static gain (in dB) on the Live Stream's mic, after the Mic Offset and Mic
 * EQ and before its limiter (`recorder-service/stream-args.ts`). The export's
 * loudness target (−16 LUFS) minus a real take's typical integrated loudness
 * (about −32 LUFS): the stream lands near the export without a loudness rider.
 * Not `−16 − speechLufs`: AV Calibration's speech-only measure reads about
 * 5 dB hotter than a whole take, so that would stream about 5 dB quiet.
 */
export const STREAM_GAIN_DB = 16;
