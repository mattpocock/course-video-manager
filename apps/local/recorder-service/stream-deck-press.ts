import type {
  RecorderCommand,
  RecorderMessage,
  RecorderState,
  StreamDeckPress,
} from "./protocol";
import { Refusal } from "./refusal";
import { refuseWakingScene } from "./screen-side";
import { STREAM_DECK_WHILE_LIVE } from "./stream-protocol";

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
 * with what the editor said (`prepare-record`). While live (`streaming`),
 * Record and Stop do nothing: only End Stream ends a streamed Recording
 * Session, and streams start only from the Streaming tab.
 */
export const pressedCommand = (
  p: StreamDeckPress,
  state: RecorderState,
  recordWith: Extract<RecorderCommand, { type: "prepare-record" }> | undefined,
  streaming = false
): RecorderCommand => {
  if (state.kind === "closed")
    throw new Refusal(
      "The recorder is not open: open the editor on a CVM recorder Video first."
    );
  const pressed = resolveToggle(p, state);
  if (streaming && pressed.action !== "switch-scene")
    throw new Refusal(STREAM_DECK_WHILE_LIVE);
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

/**
 * A Stream Deck press, carried out as the command it stands for (`run`).
 * Whatever the reason it does nothing, every client hears why
 * (`stream-deck-ignored`).
 */
export const pressStreamDeck = (
  press: StreamDeckPress,
  command: () => RecorderCommand,
  run: (command: RecorderCommand) => Promise<void>,
  broadcast: (message: RecorderMessage) => void
) =>
  Promise.resolve()
    .then(() => run(command()))
    .catch((e: unknown) => {
      if (!(e instanceof Refusal))
        console.error("recorder: a Stream Deck press failed", e);
      const message = e instanceof Error ? e.message : String(e);
      broadcast({ type: "stream-deck-ignored", press, message });
    });
