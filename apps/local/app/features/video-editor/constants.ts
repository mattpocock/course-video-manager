export const FINAL_VIDEO_PADDING = 0.5 - 0.08;
export const INSERTION_POINT_ID = "insertion-point";
export const RECORDING_SESSION_PANELS_ID = "recording-session-panels";
export const BEAT_DURATION = 0.4;
/**
 * Gain (in dB) the editor's preview player adds on top of the raw recording,
 * so footage plays back near final loudness. Preview only: exports are
 * normalised separately by ffmpeg `loudnorm`. Lowered from 14 to 12 after
 * the mic input level went up and preview became too loud.
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
