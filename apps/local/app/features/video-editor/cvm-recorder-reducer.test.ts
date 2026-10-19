import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  canRecord,
  canRetryCamera,
  createInitialCvmRecorderState,
  cvmRecorderReducer,
  framesLostAlert,
  holdsStillsOf,
} from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";
import { getRecorderCapture, toCaptureStatus } from "./recorder-capture";

/** What the teleprompter's capture indicator would show for this state. */
const captureOf = (state: cvmRecorderReducer.State) =>
  toCaptureStatus(getRecorderCapture(state));

const heard = (message: CvmRecorderMessage) =>
  ({ type: "recorder-message-heard", message }) as const;

const status = (
  o: Partial<Extract<CvmRecorderMessage, { type: "recorder-status" }>> = {}
) =>
  heard({
    type: "recorder-status",
    reachable: true,
    starting: false,
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
  tester()
    .send(status())
    .send(live)
    .send(
      heard({
        type: "recording-started",
        recordingSessionId: "s1",
        silenceLength: "long",
        micFile: "mic.mkv",
      })
    );

const tester = () =>
  new ReducerTester(cvmRecorderReducer, createInitialCvmRecorderState());

describe("the CVM recorder's Record and Stop", () => {
  it("is ready to record only once the recorder service is there and able", () => {
    const t = tester();
    expect(canRecord(t.getState())).toBe(false);
    t.send(status({ problem: "ffmpeg 8.1 is not 8.0.1" }));
    expect(canRecord(t.getState())).toBe(false);

    t.send(status()).send(live);
    expect(canRecord(t.getState())).toBe(true);
  });

  it("follows the recorder through a recording and Stop", () => {
    const t = tester();
    t.send(status())
      .send(live)
      .send(
        heard({
          type: "recording-started",
          recordingSessionId: "s1",
          silenceLength: "long",
          micFile: "mic.mkv",
        })
      )
      .send(heard({ type: "speech-started", recordingSessionId: "s1" }));
    expect(t.getState()).toMatchObject({
      phase: "recording",
      speech: { type: "speaking", soundDetectionId: null },
    });

    t.send({ type: "press-stop" }).send(heard(stoppedMessage()));
    expect(t.getState()).toMatchObject({ phase: "idle" });
    // The clip reducer hears the OBS path's start and stop; a take ended
    // mid-speech closes its audio window first.
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "start-session",
      "stop-recording",
      "close-take-window",
      "stop-session",
    ]);
  });

  it("shows a recording it did not start, and can stop it", () => {
    const t = tester();
    t.send(status({ recordingSessionId: "s1" })).send({ type: "press-stop" });
    expect(t.getEffects()).toEqual([
      {
        type: "start-session",
        recordingSessionId: "s1",
        silenceLength: "short",
      },
      { type: "stop-recording" },
    ]);
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
    expect(t.getState()).toMatchObject({ phase: "idle" });
    expect(captureOf(t.getState())).toBe("not-recording");
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

  it("holds the stills of the take being recorded until it stops, and no other Clip's", () => {
    const t = recording();
    const ofTake = { recordingSession: { id: "s1" } };
    expect(holdsStillsOf(t.getState(), ofTake)).toBe(true);
    expect(
      holdsStillsOf(t.getState(), { recordingSession: { id: "s0" } })
    ).toBe(false);
    expect(holdsStillsOf(t.getState(), { recordingSession: null })).toBe(false);

    t.send(heard(stoppedMessage())).send(status());
    expect(holdsStillsOf(t.getState(), ofTake)).toBe(false);
  });

  it("raises no alert for a recording that lost nothing", () => {
    const t = recording().send(heard(stoppedMessage()));
    expect(t.getState().framesLost).toEqual({ camera: 0, screen: 0 });
    expect(framesLostAlert(t.getState())).toBeNull();
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
    t.send(status()).send(heard({ type: "camera-opening", attempt: 1 }));
    expect(canRecord(t.getState())).toBe(false);

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

describe("scenes on the CVM recorder", () => {
  it("previews the scene the recorder says, until the camera closes", () => {
    const t = tester();
    t.send(status()).send(heard({ type: "scene-changed", scene: "Code" }));
    expect(t.getState().scene).toBe("Code");

    t.send(heard({ type: "scene-changed", scene: "Camera" }));
    expect(t.getState().scene).toBe("Camera");

    t.send(heard({ type: "camera-closed" }));
    expect(t.getState().scene).toBe(null);
  });
});

describe("the Stream Deck on the CVM recorder", () => {
  const started = heard({
    type: "recording-started",
    recordingSessionId: "s1",
    silenceLength: "long",
    micFile: "mic.mkv",
  });

  it("moves the editor through a recording and a scene switch", () => {
    const deck = tester()
      .send(status())
      .send(live)
      .send(heard({ type: "scene-changed", scene: "Code" }))
      .send(status({ recordingSessionId: "s1" }))
      .send(started)
      .send(heard({ type: "scene-changed", scene: "Camera" }));
    expect(deck.getState()).toMatchObject({
      phase: "recording",
      scene: "Camera",
    });
    expect(deck.getEffects()).toEqual([
      {
        type: "start-session",
        recordingSessionId: "s1",
        silenceLength: "short",
      },
    ]);

    deck.send(status()).send(heard(stoppedMessage()));
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

describe("silence detection on the CVM recorder, as the glass shows it", () => {
  const speechStarted = heard({
    type: "speech-started",
    recordingSessionId: "s1",
  });
  const speechEnded = heard({ type: "speech-ended", recordingSessionId: "s1" });
  const warmedUp = heard({ type: "warmed-up", recordingSessionId: "s1" });
  const takeStarted = (takeId = "s1:5") =>
    heard({
      type: "take-started",
      recordingSessionId: "s1",
      takeId,
      startTime: 0,
    });

  it("walks the OBS path's states: warming up, silence, speaking, long enough for a Clip, silence", () => {
    const t = tester().send(status()).send(live);
    expect(captureOf(t.getState())).toBe("not-recording");

    t.send(
      heard({
        type: "recording-started",
        recordingSessionId: "s1",
        silenceLength: "long",
        micFile: "mic.mkv",
      })
    );
    expect(captureOf(t.getState())).toBe("warming-up");

    t.send(warmedUp);
    expect(captureOf(t.getState())).toBe("silence");

    t.send(speechStarted);
    expect(captureOf(t.getState())).toBe("speaking-detected");
    // Speech alone is no take: the editor times nothing itself.
    expect(t.getEffects().at(-1)?.type).not.toBe("start-take");

    t.send(takeStarted());
    expect(captureOf(t.getState())).toBe(
      "long-enough-speaking-for-clip-detected"
    );
    // The speech is a take now: the clip reducer shows its Optimistic Clip.
    expect(t.getEffects().at(-1)).toEqual({
      type: "start-take",
      soundDetectionId: "s1:5",
    });

    t.send(speechEnded);
    expect(captureOf(t.getState())).toBe("silence");
    // Its audio window closes, and the app server is told where to save it.
    expect(t.getEffects().slice(-2)).toEqual([
      { type: "close-take-window" },
      { type: "place-take", recordingSessionId: "s1" },
    ]);

    t.send({ type: "press-stop" });
    // Still recording until the recorder has stopped, as OBS is.
    expect(captureOf(t.getState())).toBe("silence");
    t.send(heard(stoppedMessage()));
    expect(captureOf(t.getState())).toBe("not-recording");
  });

  it("shows no take, and places nothing, for speech the recorder never called a Take (an 'um')", () => {
    const t = recording().send(warmedUp).send(speechStarted);
    const effects = t.getEffects().length;
    t.send(speechEnded);
    expect(captureOf(t.getState())).toBe("silence");
    expect(t.getEffects().slice(effects)).toEqual([
      { type: "close-take-window" },
    ]);

    // The next speech that is a Take is placed.
    t.send(speechStarted).send(takeStarted("s1:9")).send(speechEnded);
    expect(t.getEffects().slice(effects + 1)).toEqual([
      { type: "start-take", soundDetectionId: "s1:9" },
      { type: "close-take-window" },
      { type: "place-take", recordingSessionId: "s1" },
    ]);
  });

  it("warms up again on the next Record", () => {
    const t = recording()
      .send(warmedUp)
      .send(heard(stoppedMessage()))
      .send(
        heard({
          type: "recording-started",
          recordingSessionId: "s2",
          silenceLength: "long",
          micFile: "mic2.mkv",
        })
      );
    expect(captureOf(t.getState())).toBe("warming-up");
  });

  it("closes the take's audio window when Stop lets the take go mid-speech, and places the speech when its end arrives after (#2211)", () => {
    const t = recording()
      .send(warmedUp)
      .send(speechStarted)
      .send(takeStarted())
      .send({ type: "press-stop" });
    // The recorder is open again at once; the take's files still closing.
    t.send(status());
    expect(captureOf(t.getState())).toBe("not-recording");
    expect(canRecord(t.getState())).toBe(true);
    expect(t.getEffects().slice(-2)).toEqual([
      { type: "close-take-window" },
      { type: "stop-session" },
    ]);

    // Its last speech ends where the take did, once the files are closed.
    t.send(speechEnded);
    expect(t.getEffects().at(-1)).toEqual({
      type: "place-take",
      recordingSessionId: "s1",
    });
    expect(captureOf(t.getState())).toBe("not-recording");
    t.send(heard(stoppedMessage({ framesLost: { camera: 2, screen: null } })));
    expect(t.getState().framesLost).toEqual({ camera: 2, screen: null });
  });

  it("joins a take already recording as warming up, and keeps what it hears on later status", () => {
    const t = tester().send(status({ recordingSessionId: "s1" }));
    expect(captureOf(t.getState())).toBe("warming-up");
    t.send(warmedUp).send(status({ recordingSessionId: "s1" }));
    expect(captureOf(t.getState())).toBe("silence");
  });
});

describe("events from a Recording Session that is not the current one (#2163)", () => {
  const started = (id: string) =>
    heard({
      type: "recording-started",
      recordingSessionId: id,
      silenceLength: "long",
      micFile: `${id}.mkv`,
    });
  /** s1 recorded and was stopped; its last events were held behind a failed save. */
  const stoppedWithEventsHeld = () =>
    recording()
      .send(heard({ type: "warmed-up", recordingSessionId: "s1" }))
      .send(status({ recordingSessionId: "s1" }))
      .send({ type: "press-stop" })
      .send(status());

  it("is idle once the recorder says s1 stopped, and a replay of s1 never makes it recording again", () => {
    const t = stoppedWithEventsHeld();
    expect(t.getState().phase).toBe("idle");
    const effects = t.getEffects().length;

    // The held events are saved at last, replayed from s1's start.
    t.send(started("s1"))
      .send(heard({ type: "speech-started", recordingSessionId: "s1" }))
      .send(
        heard({
          type: "take-started",
          recordingSessionId: "s1",
          takeId: "t",
          startTime: 0,
        })
      )
      .send(heard({ type: "speech-ended", recordingSessionId: "s1" }));
    expect(t.getState().phase).toBe("idle");
    expect(captureOf(t.getState())).toBe("not-recording");
    expect(canRecord(t.getState())).toBe(true);
    // Its stop has not come, so its last speech is still placed; nothing
    // records again.
    expect(t.getEffects().slice(effects)).toEqual([
      { type: "place-take", recordingSessionId: "s1" },
    ]);
  });

  it("keeps recording the new Recording Session while the old one's held events arrive", () => {
    const t = stoppedWithEventsHeld()
      .send(status({ recordingSessionId: "s2" }))
      .send(started("s2"))
      .send(heard({ type: "warmed-up", recordingSessionId: "s2" }))
      .send(heard({ type: "speech-started", recordingSessionId: "s2" }));
    const before = t.getState();
    const effects = t.getEffects().length;

    t.send(started("s1"))
      .send(heard({ type: "warmed-up", recordingSessionId: "s1" }))
      .send(heard({ type: "speech-started", recordingSessionId: "s1" }))
      .send(heard({ type: "speech-ended", recordingSessionId: "s1" }))
      .send(
        heard({ type: "camera-lost", recordingSessionId: "s1", errors: [] })
      )
      .send(heard(stoppedMessage({ recordingSessionId: "s1" })));

    expect(t.getState()).toEqual(before);
    expect(t.getEffects()).toHaveLength(effects);
    expect(t.getState().phase).toBe("recording");
    expect(captureOf(t.getState())).toBe("speaking-detected");
  });

  it("still shows what the stop of the Recording Session just recorded says, after the recorder said it stopped", () => {
    const t = recording()
      .send(status({ recordingSessionId: "s1" }))
      .send(status())
      .send(
        heard(
          stoppedMessage({
            errors: ["ffmpeg died"],
            framesLost: { camera: 2, screen: 0 },
          })
        )
      );
    expect(t.getState()).toMatchObject({
      phase: "idle",
      error: "ffmpeg died",
      framesLost: { camera: 2, screen: 0 },
    });

    const lost = recording()
      .send(status())
      .send(
        heard({ type: "camera-lost", recordingSessionId: "s1", errors: [] })
      );
    expect(lost.getState().alert).toContain("Cam Link");
  });
});
