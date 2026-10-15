import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialCvmRecorderState,
  cvmRecorderReducer,
  framesLostAlert,
} from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

/**
 * The frames-lost alert (#2227): frames lost anywhere are counted, but only
 * a loss inside a Clip's span raises the alert (cvm-recorder-frames-lost.ts).
 */

const heard = (message: CvmRecorderMessage) =>
  ({ type: "recorder-message-heard", message }) as const;

const status = () =>
  heard({
    type: "recorder-status",
    reachable: true,
    problem: null,
    recordingSessionId: null,
    previews: { camera: "c", screen: "s" },
    still: "still",
  });

const stoppedMessage = (
  o: Partial<Extract<CvmRecorderMessage, { type: "recording-stopped" }>> = {}
): CvmRecorderMessage => ({
  type: "recording-stopped",
  recordingSessionId: "s1",
  errors: [],
  crashed: false,
  framesLost: { camera: 0, screen: 0 },
  lostFrameSpans: [],
  ...o,
});

const recording = () =>
  new ReducerTester(cvmRecorderReducer, createInitialCvmRecorderState())
    .send(status())
    .send(heard({ type: "camera-went-live" }))
    .send(
      heard({
        type: "recording-started",
        recordingSessionId: "s1",
        silenceLength: "long",
        micFile: "mic.mkv",
      })
    );

describe("frames lost (#2227): alerted only inside a Clip", () => {
  const lostIn = (
    lostFrameSpans: {
      picture: "camera" | "screen";
      from: number;
      to: number;
      frames: number;
    }[],
    recordingSessionId = "s1"
  ) =>
    heard({
      type: "frames-lost",
      recordingSessionId,
      framesLost: {
        camera: lostFrameSpans
          .filter((l) => l.picture === "camera")
          .reduce((n, l) => n + l.frames, 0),
        screen: lostFrameSpans
          .filter((l) => l.picture === "screen")
          .reduce((n, l) => n + l.frames, 0),
      },
      lostFrameSpans,
    });
  const takeStarted = (takeId: string, startTime: number) =>
    heard({
      type: "take-started",
      recordingSessionId: "s1",
      takeId,
      startTime,
    });
  const speechEnded = (startTime: number, endTime: number) =>
    heard({
      type: "speech-ended",
      recordingSessionId: "s1",
      clip: { startTime, endTime },
    });
  const atStartup = {
    picture: "screen" as const,
    from: 0.1,
    to: 0.9,
    frames: 54,
  };

  it("raises nothing for frames lost with no Clip: the recorder starting up", () => {
    const t = recording().send(lostIn([atStartup]));
    expect(t.getState().framesLost).toEqual({ camera: 0, screen: 54 });
    expect(framesLostAlert(t.getState())).toBeNull();

    t.send(
      heard(
        stoppedMessage({
          framesLost: { camera: 0, screen: 54 },
          lostFrameSpans: [atStartup],
        })
      )
    );
    expect(framesLostAlert(t.getState())).toBeNull();
  });

  it("raises nothing for frames lost in the silence between Clips", () => {
    const t = recording()
      .send(takeStarted("s1:4", 2))
      .send(speechEnded(2, 5))
      .send(lostIn([{ picture: "camera", from: 6, to: 6.2, frames: 5 }]))
      .send(takeStarted("s1:9", 8))
      .send(speechEnded(8, 10));
    expect(framesLostAlert(t.getState())).toBeNull();
  });

  it("alerts the moment a loss falls in the Clip being recorded, and names it once its speech ends", () => {
    const t = recording()
      .send(takeStarted("s1:4", 2))
      .send(speechEnded(2, 5))
      .send(takeStarted("s1:9", 8))
      .send(lostIn([{ picture: "camera", from: 9, to: 9.2, frames: 6 }]));
    expect(framesLostAlert(t.getState())).toBe(
      "Frames lost in the Clip being recorded: 6 camera frames. It has a freeze in it."
    );

    t.send(speechEnded(8, 10));
    expect(framesLostAlert(t.getState())).toBe(
      "Frames lost in Clip 2 of this recording: 6 camera frames. It has a freeze in it."
    );
  });

  it("alerts for a loss told before its Take was known, once the Take starts", () => {
    // Speech from 8 s, lost at 8.5 s, a Take from 8 s decided at 11 s.
    const t = recording().send(
      lostIn([{ picture: "screen", from: 8.5, to: 8.6, frames: 5 }])
    );
    expect(framesLostAlert(t.getState())).toBeNull();
    t.send(takeStarted("s1:4", 8));
    expect(framesLostAlert(t.getState())).toContain("5 screen frames");
  });

  it("works it out again at Stop, from every span the take lost, told or not", () => {
    const t = recording()
      .send(takeStarted("s1:4", 2))
      .send(speechEnded(2, 5))
      .send(takeStarted("s1:9", 8));
    expect(framesLostAlert(t.getState())).toBeNull();
    t.send(speechEnded(8, 10)).send(
      heard(
        stoppedMessage({
          framesLost: { camera: 3, screen: 54 },
          lostFrameSpans: [
            atStartup,
            { picture: "camera", from: 3, to: 3, frames: 1 },
            { picture: "camera", from: 9.9, to: 10.1, frames: 2 },
          ],
        })
      )
    );
    expect(framesLostAlert(t.getState())).toBe(
      "Frames lost in Clips 1 and 2 of the last recording: 3 camera frames. Each has a freeze in it."
    );
  });

  it("keeps the alert after Stop, ignores another Recording Session's, and clears it at the next Record", () => {
    const t = recording()
      .send(takeStarted("s1:4", 2))
      .send(lostIn([{ picture: "camera", from: 3, to: 3.2, frames: 6 }]))
      .send(lostIn([{ picture: "camera", from: 3, to: 4, frames: 99 }], "s0"));
    expect(framesLostAlert(t.getState())).toContain("6 camera frames");
    expect(t.getState().framesLost).toEqual({ camera: 6, screen: 0 });

    t.send(speechEnded(2, 5)).send(
      heard(
        stoppedMessage({
          framesLost: { camera: 6, screen: 0 },
          lostFrameSpans: [{ picture: "camera", from: 3, to: 3.2, frames: 6 }],
        })
      )
    );
    expect(framesLostAlert(t.getState())).toBe(
      "Frames lost in Clip 1 of the last recording: 6 camera frames. It has a freeze in it."
    );

    t.send(status()).send(
      heard({
        type: "recording-started",
        recordingSessionId: "s2",
        silenceLength: "long",
        micFile: "mic.mkv",
      })
    );
    expect(framesLostAlert(t.getState())).toBeNull();
    expect(t.getState().takeSpans).toEqual([]);
  });

  it("starts afresh when the Stream Deck starts the next Recording Session", () => {
    const t = recording()
      .send(takeStarted("s1:4", 2))
      .send(lostIn([{ picture: "camera", from: 3, to: 3.2, frames: 6 }]))
      .send(speechEnded(2, 5))
      .send(heard(stoppedMessage()))
      .send(status())
      .send(
        heard({
          type: "recording-started",
          recordingSessionId: "s2",
          silenceLength: "long",
          micFile: "mic.mkv",
        })
      );
    expect(framesLostAlert(t.getState())).toBeNull();
  });
});
