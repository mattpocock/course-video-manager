import type { RecorderState, StreamDeckPress } from "./protocol";

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
