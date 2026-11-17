import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";
import { useCvmRecorder, type CvmRecorderControls } from "./use-cvm-recorder";

/**
 * `useCvmRecorder`'s lifecycle under StrictMode, as the app runs it: the
 * simulated unmount and remount must leave the recorder following the
 * Video's recorder events, and each effect must run once.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let source: { emit: (m: CvmRecorderMessage) => void } | undefined;
class FakeEventSource {
  private listeners = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(_url: string) {
    source = {
      emit: (m) =>
        this.listeners
          .get(m.type)
          ?.forEach((l) => l({ data: JSON.stringify(m) })),
    };
  }
  addEventListener(type: string, listener: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {}
}

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}"))
  );
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

it("under StrictMode, still follows the recorder and runs each effect once", async () => {
  const clipActions: string[] = [];
  let controls: CvmRecorderControls | undefined;
  function Editor() {
    const recorder = useCvmRecorder({
      video: { id: "v1", format: "landscape" },
      silenceLength: "short",
      clipDispatch: (action) => clipActions.push(action.type),
      onNewClipOptimisticallyAdded: () => {},
      onClipAudioWindowClosed: () => {},
      micOffsetRefusal: null,
      insertionPoint: () => ({ type: "start" }),
    });
    controls = recorder.controls;
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() =>
    root!.render(
      <StrictMode>
        <Editor />
      </StrictMode>
    )
  );

  await act(async () => {
    source!.emit({
      type: "recorder-status",
      reachable: true,
      starting: false,
      problem: null,
      recordingSessionId: null,
      streamed: false,
      previews: { camera: "http://r/c", screen: "http://r/s" },
      still: "http://r/still",
    });
    source!.emit({
      type: "recording-started",
      recordingSessionId: "s1",
      silenceLength: "short",
      micFile: "mic.mkv",
    });
  });

  expect(controls!.store.getSnapshot().phase).toBe("recording");
  expect(clipActions).toEqual(["recording-started"]);
});
