import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  canRecord,
  canRetryCamera,
  canSwitchScene,
  createInitialNewRecorderState,
  newRecorderReducer,
} from "./new-recorder-reducer";
import type { NewRecorderMessage } from "./new-recorder-wire";

const heard = (message: NewRecorderMessage) =>
  ({ type: "recorder-message-heard", message }) as const;

const status = (
  o: Partial<Extract<NewRecorderMessage, { type: "recorder-status" }>> = {}
) =>
  heard({
    type: "recorder-status",
    reachable: true,
    problem: null,
    recordingSessionId: null,
    previews: {
      camera: "http://r/preview/camera",
      screen: "http://r/preview/screen",
    },
    still: "http://r/still",
    ...o,
  });

const live = heard({ type: "camera-went-live" });

const pressRecord = {
  type: "press-record",
  silenceLength: "long",
  insertionPoint: { type: "start" },
} as const;

const stoppedMessage = (
  o: Partial<Extract<NewRecorderMessage, { type: "recording-stopped" }>> = {}
): NewRecorderMessage => ({
  type: "recording-stopped",
  recordingSessionId: "s1",
  errors: [],
  crashed: false,
  framesLost: { camera: 0, screen: 0 },
  ...o,
});

const recording = () =>
  tester()
    .send(status())
    .send(live)
    .send(pressRecord)
    .send(
      heard({
        type: "recording-started",
        recordingSessionId: "s1",
        silenceLength: "long",
        micFile: "mic.mkv",
      })
    );

const tester = () =>
  new ReducerTester(newRecorderReducer, createInitialNewRecorderState());

describe("the New recorder's Record and Stop", () => {
  it("records only once the recorder service is there and able", () => {
    const t = tester();
    t.send(pressRecord);
    t.send(status({ problem: "ffmpeg 8.1 is not 8.0.1" })).send(pressRecord);
    expect(canRecord(t.getState())).toBe(false);
    expect(t.getEffects()).toEqual([]);

    t.send(status()).send(live).send(pressRecord);
    expect(t.getEffects()).toEqual([
      {
        type: "start-recording",
        silenceLength: "long",
        insertionPoint: { type: "start" },
      },
    ]);
    expect(t.getState().phase).toBe("starting");
  });

  it("follows the recorder through a recording and Stop", () => {
    const t = tester();
    t.send(status())
      .send(live)
      .send(pressRecord)
      .send(
        heard({
          type: "recording-started",
          recordingSessionId: "s1",
          silenceLength: "long",
          micFile: "mic.mkv",
        })
      )
      .send(heard({ type: "speech-started", recordingSessionId: "s1" }));
    expect(t.getState()).toMatchObject({ phase: "recording", speaking: true });

    t.send({ type: "press-stop" }).send(heard(stoppedMessage()));
    expect(t.getState()).toMatchObject({ phase: "idle", speaking: false });
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "start-recording",
      "stop-recording",
    ]);
  });

  it("shows a recording it did not start, and can stop it", () => {
    const t = tester();
    t.send(status({ recordingSessionId: "s1" })).send({ type: "press-stop" });
    expect(t.getEffects()).toEqual([{ type: "stop-recording" }]);
  });

  it("shows why Record was refused and lets it be pressed again", () => {
    const t = tester();
    t.send(status())
      .send(live)
      .send(pressRecord)
      .send({ type: "start-recording-failed", message: "Close OBS first" });
    expect(t.getState()).toMatchObject({
      phase: "idle",
      error: "Close OBS first",
    });

    t.send(pressRecord);
    expect(t.getState().error).toBeNull();
    expect(t.getEffects()).toHaveLength(2);
  });

  it("raises a loud alert when the camera is lost, back to not recording, until dismissed", () => {
    const t = recording()
      .send(heard({ type: "speech-started", recordingSessionId: "s1" }))
      .send(
        heard({
          type: "camera-lost",
          recordingSessionId: "s1",
          errors: ["I/O error"],
        })
      );
    expect(t.getState()).toMatchObject({ phase: "idle", speaking: false });
    expect(t.getState().alert).toContain("Cam Link");
    expect(t.getState().alert).toContain("replug");
    // Record waits for the recorder to have the Cam Link live again.
    expect(canRecord(t.getState())).toBe(false);
    t.send(live);
    expect(canRecord(t.getState())).toBe(true);

    // The stop that follows does not hide it; dismissing does.
    t.send(heard(stoppedMessage()));
    expect(t.getState().alert).toContain("Cam Link");
    t.send({ type: "dismiss-alert" });
    expect(t.getState().alert).toBeNull();
  });

  it("shows the frames lost once a recording stops", () => {
    const t = recording();
    expect(t.getState().framesLost).toBeNull();

    t.send(heard(stoppedMessage({ framesLost: { camera: 1, screen: 0 } })));
    expect(t.getState().framesLost).toEqual({ camera: 1, screen: 0 });

    t.send(pressRecord);
    expect(t.getState().framesLost).toBeNull();
  });

  it("says a Recording Session was cut off by a crash and its Clips kept", () => {
    const t = recording().send(
      heard(stoppedMessage({ crashed: true, framesLost: null }))
    );
    expect(t.getState().phase).toBe("idle");
    expect(t.getState().alert).toContain("crash");
  });
});

describe("the Cam Link in the editor", () => {
  it("keeps Record disabled until the camera went live", () => {
    const t = tester();
    t.send(status())
      .send(heard({ type: "camera-opening", attempt: 1 }))
      .send(pressRecord);
    expect(canRecord(t.getState())).toBe(false);
    expect(t.getEffects()).toEqual([]);

    t.send(live);
    expect(canRecord(t.getState())).toBe(true);

    t.send(heard({ type: "camera-closed" }));
    expect(canRecord(t.getState())).toBe(false);
  });

  it("shows the replug message, and clears it once Retry has the camera opening again", () => {
    const t = tester();
    t.send(status())
      .send(heard({ type: "camera-opening", attempt: 3 }))
      .send(heard({ type: "cam-link-not-starting", message: "replug it" }));
    expect(t.getState().camera).toEqual({
      kind: "not-starting",
      message: "replug it",
    });
    expect(canRetryCamera(t.getState())).toBe(true);

    t.send({ type: "press-retry" });
    expect(t.getEffects()).toEqual([{ type: "retry-camera" }]);
    expect(canRetryCamera(t.getState())).toBe(false);

    t.send(heard({ type: "camera-opening", attempt: 1 })).send(live);
    expect(t.getState().camera).toEqual({ kind: "live" });
    expect(canRecord(t.getState())).toBe(true);
  });

  it("shows Close OBS first until Retry, and why a Retry failed", () => {
    const t = tester();
    t.send(status()).send(
      heard({ type: "cam-link-busy", message: "Close OBS first" })
    );
    expect(t.getState().camera).toMatchObject({ kind: "busy" });

    t.send({ type: "press-retry" }).send({
      type: "retry-camera-failed",
      message: "The recorder service went away.",
    });
    expect(t.getState()).toMatchObject({
      camera: { kind: "busy", message: "Close OBS first" },
      error: "The recorder service went away.",
    });
    expect(canRetryCamera(t.getState())).toBe(true);

    t.send({ type: "press-retry" }).send(
      heard({ type: "camera-opening", attempt: 1 })
    );
    expect(t.getState()).toMatchObject({
      camera: { kind: "opening" },
      error: null,
    });
  });
});

describe("switching scenes on the New recorder", () => {
  it("previews the scene the recorder says, and asks for a switch only while it is open", () => {
    const t = tester();
    t.send(status()).send({ type: "press-scene", scene: "Camera" });
    expect(canSwitchScene(t.getState())).toBe(false);
    expect(t.getEffects()).toEqual([]);

    t.send(heard({ type: "scene-changed", scene: "Code" }));
    expect(t.getState().scene).toBe("Code");

    t.send({ type: "press-scene", scene: "Code" });
    expect(t.getEffects()).toEqual([]);
    t.send({ type: "press-scene", scene: "Camera" });
    expect(t.getEffects()).toEqual([{ type: "switch-scene", scene: "Camera" }]);
    // The preview follows the recorder, not the press.
    expect(t.getState().scene).toBe("Code");

    t.send(heard({ type: "scene-changed", scene: "Camera" }));
    expect(t.getState().scene).toBe("Camera");

    t.send(heard({ type: "camera-closed" }));
    expect(t.getState().scene).toBe(null);
    expect(canSwitchScene(t.getState())).toBe(false);
  });

  it("says why a switch failed", () => {
    const t = tester();
    t.send(status())
      .send(heard({ type: "scene-changed", scene: "Code" }))
      .send({ type: "press-scene", scene: "No Face" })
      .send({ type: "switch-scene-failed", message: "Not open." });
    expect(t.getState()).toMatchObject({ scene: "Code", error: "Not open." });
  });
});

describe("the Stream Deck on the New recorder", () => {
  const started = heard({
    type: "recording-started",
    recordingSessionId: "s1",
    silenceLength: "long",
    micFile: "mic.mkv",
  });

  it("moves the editor through a recording and a scene switch exactly as its own buttons would", () => {
    const opened = () =>
      tester()
        .send(status())
        .send(live)
        .send(heard({ type: "scene-changed", scene: "Code" }));

    const buttons = opened()
      .send(pressRecord)
      .send(status({ recordingSessionId: "s1" }))
      .send(started)
      .send({ type: "press-scene", scene: "Camera" })
      .send(heard({ type: "scene-changed", scene: "Camera" }));
    // The Stream Deck pressed them on the recorder service: only its events.
    const deck = opened()
      .send(status({ recordingSessionId: "s1" }))
      .send(started)
      .send(heard({ type: "scene-changed", scene: "Camera" }));
    expect(deck.getState()).toEqual(buttons.getState());
    expect(deck.getState()).toMatchObject({
      phase: "recording",
      scene: "Camera",
    });
    expect(deck.getEffects()).toEqual([]);

    buttons
      .send({ type: "press-stop" })
      .send(status())
      .send(heard(stoppedMessage()));
    deck.send(status()).send(heard(stoppedMessage()));
    expect(deck.getState()).toEqual(buttons.getState());
    expect(deck.getState().phase).toBe("idle");
  });

  it("tells the app server its Silence Length once it answers, and on each change", () => {
    const t = tester();
    t.send({ type: "silence-length-chosen", silenceLength: "short" });
    t.send({ type: "silence-length-chosen", silenceLength: "long" });
    expect(t.getEffects()).toEqual([]);

    t.send(status())
      .send({ type: "silence-length-chosen", silenceLength: "long" })
      .send({ type: "silence-length-chosen", silenceLength: "short" })
      // A restarted app server greets the editor again.
      .send(status());
    expect(t.getEffects()).toEqual([
      { type: "send-silence-length", silenceLength: "long" },
      { type: "send-silence-length", silenceLength: "short" },
      { type: "send-silence-length", silenceLength: "short" },
    ]);
  });
});
