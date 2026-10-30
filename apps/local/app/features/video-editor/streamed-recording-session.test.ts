import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialCvmRecorderState,
  cvmRecorderReducer,
  followedOnLeave,
  holdsRecordingSession,
} from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

/**
 * A streamed Recording Session (Go Live's) survives leaving the page (ADR
 * 0055): the Streaming tab, or any page on its Video, never stops it, on
 * leaving or on Attaching. One that is not streamed keeps ADR 0050's rules.
 */

const heard = (message: CvmRecorderMessage) =>
  ({ type: "recorder-message-heard", message }) as const;

const status = (recordingSessionId: string | null, streamed: boolean) =>
  heard({
    type: "recorder-status",
    reachable: true,
    starting: false,
    problem: null,
    recordingSessionId,
    streamed,
    previews: { camera: "c", screen: "s" },
    still: "still",
  });

const tester = () =>
  new ReducerTester(cvmRecorderReducer, createInitialCvmRecorderState());

const stops = (t: ReturnType<typeof tester>) =>
  t.getEffects().filter((e) => e.type === "stop-recording");

describe("a streamed Recording Session and the page following it", () => {
  it("re-attaches to a streamed Recording Session it first hears (a return or a refresh), and stops nothing", () => {
    const t = tester().send(status("s1", true));
    expect(t.getState()).toMatchObject({
      phase: "recording",
      recordingSessionId: "s1",
    });
    expect(t.getEffects()).toEqual([
      {
        type: "start-session",
        recordingSessionId: "s1",
        silenceLength: "short",
      },
    ]);

    // One that is not streamed is still stopped (ADR 0050 point 4).
    const plain = tester().send(status("s1", false));
    expect(stops(plain)).toHaveLength(1);
  });

  it("hands nothing back on leaving while streamed, and a Recording Session that isn't streamed as before", () => {
    const streamed = tester()
      .send(status(null, false))
      .send(status("s1", true));
    expect(followedOnLeave(streamed.getState())).toBeNull();
    expect(stops(streamed)).toHaveLength(0);

    const plain = tester()
      .send(status(null, false))
      .send(
        heard({
          type: "recording-started",
          recordingSessionId: "s1",
          silenceLength: "short",
          micFile: "mic.mkv",
        })
      );
    expect(followedOnLeave(plain.getState())).toBe("s1");
  });

  it("is followed as any Recording Session once End Stream stops it, and the next one is not streamed", () => {
    const t = tester()
      .send(status(null, false))
      .send(status("s1", true))
      .send(status(null, false))
      .send(status("s2", false));
    expect(t.getState().recordingSessionId).toBe("s2");
    expect(followedOnLeave(t.getState())).toBe("s2");
  });

  it("holds the recorder, focused or not, from Go Live until the Live Stream ends", () => {
    const t = tester()
      .send(status(null, false))
      .send(heard({ type: "stream-changed", stream: { kind: "starting" } }));
    expect(holdsRecordingSession(t.getState())).toBe(true);
    t.send(
      heard({
        type: "stream-changed",
        stream: { kind: "ended", reason: "End Stream." },
      })
    );
    expect(holdsRecordingSession(t.getState())).toBe(false);
  });
});
