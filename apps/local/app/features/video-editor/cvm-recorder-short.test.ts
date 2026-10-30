import { describe, expect, it } from "vitest";
import { SCENES, type Scene } from "@/packages/scene-layout";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  canRecord,
  canWakeSpacedeskAgain,
  createInitialCvmRecorderState,
  cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import {
  isSceneAvailable,
  recordNeedsScreenHint,
  screenStatusText,
} from "./cvm-recorder-screen";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";
import { getCvmRecorderLivePreview } from "./live-preview";
import { SPACEDESK_DEFAULT_PORT, SPACEDESK_HOST } from "@/spacedesk-wake";

/**
 * A Short on the CVM recorder, in the editor: the recorder wakes Spacedesk
 * as it opens, and until the Spacedesk display is ready only Camera (which
 * does not draw the screen) can be switched to or recorded in.
 */

const heard = (message: CvmRecorderMessage) =>
  ({ type: "recorder-message-heard", message }) as const;

const UNAVAILABLE = `Could not wake Spacedesk: timed out after 8 s against ${SPACEDESK_HOST}:${SPACEDESK_DEFAULT_PORT}`;

const screen = (
  s: Extract<CvmRecorderMessage, { type: "screen-changed" }>["screen"]
) => heard({ type: "screen-changed", screen: s });

/** The recorder open for this Video, in `scene`, with the Cam Link live. */
const open = (format: "short" | "landscape", scene: Scene = "Code") =>
  new ReducerTester(cvmRecorderReducer, createInitialCvmRecorderState(format))
    .send(
      heard({
        type: "recorder-status",
        reachable: true,
        starting: false,
        problem: null,
        recordingSessionId: null,
        streamed: false,
        previews: { camera: "http://r/camera", screen: "http://r/screen" },
        still: "http://r/still",
      })
    )
    .send(heard({ type: "scene-changed", scene }))
    .send(heard({ type: "camera-went-live" }));

const available = (state: cvmRecorderReducer.State) =>
  SCENES.filter((scene) => isSceneAvailable(state, scene));

describe("a Short on the CVM recorder", () => {
  it("while Spacedesk wakes, offers Camera only, says so, and holds Record (the recorder refuses it) even in Camera", () => {
    const t = open("short", "Camera").send(screen({ kind: "waking" }));
    const state = t.getState();
    expect(available(state)).toEqual(["Camera"]);
    expect(screenStatusText(state)).toBe("Waking Spacedesk…");
    expect(canWakeSpacedeskAgain(state)).toBe(false);
    expect(canRecord(state)).toBe(false);
    expect(recordNeedsScreenHint(state)).toBeNull();

    t.send(screen({ kind: "unavailable", message: UNAVAILABLE }));
    expect(canRecord(t.getState())).toBe(true);
  });

  it("once the screen is ready, offers every scene and records in Code", () => {
    const state = open("short")
      .send(screen({ kind: "ready" }))
      .getState();
    expect(available(state)).toEqual(["Camera", "Code", "No Face"]);
    expect(screenStatusText(state)).toBeNull();
    expect(canRecord(state)).toBe(true);
    expect(recordNeedsScreenHint(state)).toBeNull();
  });

  it("with the screen unavailable, says why, and records in Camera only", () => {
    const t = open("short").send(
      screen({ kind: "unavailable", message: UNAVAILABLE })
    );
    expect(screenStatusText(t.getState())).toBe(UNAVAILABLE);
    expect(available(t.getState())).toEqual(["Camera"]);

    // In Code (the recorder's default scene), Record waits for Camera.
    expect(canRecord(t.getState())).toBe(false);
    expect(recordNeedsScreenHint(t.getState())).toBe(
      "Code shows the screen, which is not ready: pick Camera to record without it."
    );

    t.send(heard({ type: "scene-changed", scene: "Camera" }));
    expect(canRecord(t.getState())).toBe(true);
  });

  it("wakes Spacedesk again once, until the recorder says it is waking", () => {
    const t = open("short").send(
      screen({ kind: "unavailable", message: UNAVAILABLE })
    );
    expect(canWakeSpacedeskAgain(t.getState())).toBe(true);
    t.send({ type: "press-wake-spacedesk" });
    t.send({ type: "press-wake-spacedesk" });
    expect(t.getEffects()).toEqual([{ type: "retry-screen" }]);

    t.send(screen({ kind: "waking" }));
    expect(screenStatusText(t.getState())).toBe("Waking Spacedesk…");
    t.send(screen({ kind: "unavailable", message: UNAVAILABLE }));
    expect(canWakeSpacedeskAgain(t.getState())).toBe(true);
  });

  it("a refused wake says why and may be pressed again", () => {
    const t = open("short")
      .send(screen({ kind: "unavailable", message: UNAVAILABLE }))
      .send({ type: "press-wake-spacedesk" })
      .send({
        type: "retry-screen-failed",
        message: "Spacedesk is already waking.",
      });
    expect(t.getState().error).toBe("Spacedesk is already waking.");
    expect(canWakeSpacedeskAgain(t.getState())).toBe(true);
  });

  it("forgets the screen once the recorder is not this Video's", () => {
    const t = open("short")
      .send(screen({ kind: "ready" }))
      .send(heard({ type: "camera-closed" }));
    expect(t.getState().screen).toBeNull();
  });

  it("draws the live composite on the Short's 9:16 canvas", () => {
    const preview = getCvmRecorderLivePreview(
      open("short")
        .send(screen({ kind: "waking" }))
        .getState()
    );
    expect(preview).toMatchObject({
      format: "short",
      canvas: { width: 1080, height: 1920 },
    });
  });
});

describe("a Landscape Video on the CVM recorder", () => {
  it("offers every scene (the recorder checks the DELL at Record) on a 16:9 canvas", () => {
    const state = open("landscape").getState();
    expect(available(state)).toEqual(["Camera", "Code", "No Face"]);
    expect(screenStatusText(state)).toBeNull();
    expect(canRecord(state)).toBe(true);
    expect(getCvmRecorderLivePreview(state)).toMatchObject({
      format: "landscape",
      canvas: { width: 1920, height: 1080 },
    });
  });
});
