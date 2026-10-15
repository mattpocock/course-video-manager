import type { SilenceLength } from "@/silence-detection-constants";
import type { ClipReducerAction } from "./clip-state-reducer";
import type { OBSConnectionInnerState } from "./obs-connector";
import type { FrontendSpeechDetectorState } from "./speech-detector-reducer";

/**
 * The OBS bridge onto the clip reducer: what a change in the OBS connector
 * (`obsConnectorReducer`) or its speech detector (`speechDetectorReducer`)
 * means for the editor's Recording Sessions and Takes. The CVM recorder's
 * counterpart is `cvmRecorderReducer`'s effects (ADR 0044). Pure: the edit
 * route and `useOBSConnector` call these with what they hold, and dispatch
 * or call back with what comes out.
 */

/**
 * The clip events a change of OBS's state means: it starting to record
 * starts a session, it stopping stops one. A take the AV Calibration gate
 * refused never reaches `obs-recording`, so never starts a session.
 */
export const obsSessionEvents = (
  before: OBSConnectionInnerState["type"],
  after: OBSConnectionInnerState,
  silenceLength: SilenceLength
): ClipReducerAction[] => {
  if (before !== "obs-recording" && after.type === "obs-recording")
    return [
      {
        type: "recording-started",
        outputPath: after.latestOutputPath,
        silenceLength,
        silenceThresholdDb: after.silenceThresholdDb,
      },
    ];
  if (before === "obs-recording" && after.type !== "obs-recording")
    return [{ type: "recording-stopped" }];
  return [];
};

export type OBSTakeSignal =
  | {
      /** Speech long enough for a Clip: a Take starts. */
      type: "take-started";
      scene: string;
      profile: string;
      soundDetectionId: string;
    }
  /** Silence: the audio window of the Take in progress closes. */
  | { type: "take-window-closed" };

/**
 * What a change of the speech detector's state means for a Take, while OBS
 * records. Speech becoming long enough starts one; silence closes its
 * window. Nothing while OBS is not recording.
 */
export const obsTakeSignal = (
  before: FrontendSpeechDetectorState,
  after: FrontendSpeechDetectorState,
  obs: OBSConnectionInnerState
): OBSTakeSignal | null => {
  if (obs.type !== "obs-recording") return null;
  if (
    before.type === "speaking-detected" &&
    after.type === "long-enough-speaking-for-clip-detected"
  )
    return {
      type: "take-started",
      scene: obs.scene,
      profile: obs.profile,
      soundDetectionId: after.soundDetectionId,
    };
  if (before.type !== "silence" && after.type === "silence")
    return { type: "take-window-closed" };
  return null;
};
