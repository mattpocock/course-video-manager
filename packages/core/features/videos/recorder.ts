/**
 * A Recorder: what filmed a Clip.
 *
 * - `cvm` — CVM's own recorder, the only Recorder (ADR 0051). It writes a
 *   Recording Session: camera, screen and mic as three Footage files plus a
 *   scene timeline, so the picture is drawn at export and a Clip can carry a
 *   Scene Override.
 * - `obs` — OBS, which no longer records. Its Clips stay: one Footage file
 *   with the scene baked in, played, stilled, transcribed and exported as
 *   they always were.
 *
 * A Recorder belongs to each Clip (`clipRecorder`). `video.recorder` is a
 * legacy column: kept, with its values, but no longer read or written —
 * every Video records with the CVM recorder.
 */
export const VIDEO_RECORDERS = ["obs", "cvm"] as const;

export type VideoRecorder = (typeof VIDEO_RECORDERS)[number];

/** The Recorder a Clip was filmed with: a Recording Session means the CVM recorder. */
export function clipRecorder(clip: {
  readonly recordingSessionId: string | null;
}): VideoRecorder {
  return clip.recordingSessionId !== null ? "cvm" : "obs";
}

/**
 * Where a Recording Session stands (`recording_session.status`):
 * `recording` while the recorder is writing its files, `stopped` once it
 * finished them cleanly, `crashed` when the recorder found it still
 * `recording` after a restart.
 */
export const RECORDING_SESSION_STATUSES = [
  "recording",
  "stopped",
  "crashed",
] as const;

export type RecordingSessionStatus =
  (typeof RECORDING_SESSION_STATUSES)[number];

/**
 * The scenes a Recording Session's picture can be drawn in. A scene event
 * records which one was live from a moment in the Footage on; a Clip's Scene
 * Override replaces them for that Clip alone.
 */
export const RECORDING_SESSION_SCENES = ["Camera", "Code", "No Face"] as const;

export type RecordingSessionScene = (typeof RECORDING_SESSION_SCENES)[number];

/**
 * The mic offset a new Recording Session gets when its camera + mic pair
 * was never measured, in ms (a measured pair's Mic Offset otherwise: see
 * `pairMicOffsetMs`): the mic's sound is shifted later by this much at
 * export. 150 ms matches the sync offset OBS
 * applies to the same mic, which the CVM recorder's raw files do not carry.
 */
export const DEFAULT_MIC_OFFSET_MS = 150;

/**
 * The range a Recording Session's mic offset may be set to, in ms. Lip sync
 * is corrected by a few hundred ms at most; anything past two seconds is a
 * typo, not a correction.
 */
export const MIC_OFFSET_MS_RANGE = { min: -2000, max: 2000 } as const;

/**
 * The mic EQ the export applies to a Recording Session's mic: the gains, in
 * dB, of OBS's 3-Band Equalizer filter (bands split at 800 Hz and 5 kHz), the
 * filter OBS runs on the same mic. Raw Footage is never changed.
 */
export type MicEq = {
  readonly lowDb: number;
  readonly midDb: number;
  readonly highDb: number;
};

/** Matt's OBS mic EQ: highs down 6.1 dB, low and mid flat. */
export const DEFAULT_MIC_EQ: MicEq = { lowDb: 0, midDb: 0, highDb: -6.1 };

/**
 * The one saved Mic EQ Setting every Recording Session is exported with
 * (`recording_session.mic_eq_setting_id`). Saving it re-EQs every
 * CVM-recorder Video; until it is first saved the mic reads as
 * {@link DEFAULT_MIC_EQ}.
 */
export const MIC_EQ_SETTING_ID = "default";

/** The gain each band of the mic EQ may be set to, in dB. */
export const MIC_EQ_DB_RANGE = { min: -24, max: 24 } as const;
