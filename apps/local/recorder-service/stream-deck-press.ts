import type {
  RecorderCommand,
  RecorderState,
  StreamDeckPress,
} from "./protocol";
import { Refusal } from "./refusal";
import { refuseWakingScene } from "./screen-side";

/**
 * The Record toggle as the plain press it stands for: Stop while recording,
 * Record otherwise. It asks the service's own state, so the key never
 * disagrees with the recorder.
 */
export const resolveToggle = (
  press: StreamDeckPress,
  state: RecorderState
): Exclude<StreamDeckPress, { action: "toggle-record" }> =>
  press.action === "toggle-record"
    ? { action: state.kind === "recording" ? "stop" : "record" }
    : press;

/**
 * A Stream Deck button as the command it stands for, on whichever Video the
 * recorder is open for; refuses with why it can do nothing. A Record records
 * with what the editor said (`prepare-record`).
 */
export const pressedCommand = (
  p: StreamDeckPress,
  state: RecorderState,
  recordWith: Extract<RecorderCommand, { type: "prepare-record" }> | undefined
): RecorderCommand => {
  if (state.kind === "closed")
    throw new Refusal(
      "The recorder is not open: open the editor on a CVM recorder Video first."
    );
  const pressed = resolveToggle(p, state);
  switch (pressed.action) {
    case "record":
      if (recordWith?.videoId !== state.videoId)
        throw new Refusal(
          "The editor has not said its Silence Length yet: reload the editor."
        );
      return {
        type: "record",
        silenceLength: recordWith.silenceLength,
        folder: recordWith.folder,
        calibration: recordWith.calibration,
      };
    case "stop":
      return { type: "stop" };
    case "switch-scene":
      refuseWakingScene(pressed.scene, state.format, state.screen);
      return { type: "switch-scene", scene: pressed.scene };
  }
};
