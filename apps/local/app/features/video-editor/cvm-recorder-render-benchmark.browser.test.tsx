import { fromPartial } from "@total-typescript/shoehorn";
import { act, Profiler, StrictMode, useReducer, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useContextSelector } from "use-context-selector";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSelector } from "@/hooks/effect-store";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";
import {
  canStop,
  framesLostAlert,
  holdsStillsOf,
  isCvmRecorderRecording,
  stillRound,
} from "./cvm-recorder-reducer";
import { screenStatusText } from "./cvm-recorder-screen";
import {
  getCvmRecorderLivePreview,
  getHasLivePreview,
  sameLivePreview,
} from "./live-preview";
import { captureProps } from "./recorder-capture";
import { useCvmRecorder, type CvmRecorderControls } from "./use-cvm-recorder";
import { useCvmRecorderSelector } from "./use-cvm-recorder-selector";
import {
  VideoEditorContext,
  type VideoEditorContextType,
} from "./video-editor-context";

/**
 * RENDER BENCHMARK. The recorder in its effect store (`hooks/effect-store.ts`),
 * each consumer reading its slice with a selector. The same event stream ran
 * against origin/main's `useEffectReducer` version of this file (branch
 * `xstate-strict-poc-baseline`) and #2713's XState version; only `Host`,
 * `Editor` and the leaves' subscriptions differ, each copying the real
 * component's subscription.
 *
 * The tree is the editor's shape: the wiring hook at the top (`Host`, as
 * `useVideoEditorWiring`), `VideoEditor` under it with no `memo`, and the
 * recorder's consumers under that. A clip effect re-renders `Host`, as the
 * clip reducer living there does. Counts are deterministic; wall-clock is
 * logged for the report and never asserted.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CLIPS = 30;
const TAKES = 10;
const STATUS_PER_TAKE = 5;
const FRAMES_LOST_PER_TAKE = 3;

// ---------------------------------------------------------------------------
// The shared harness: identical on both branches.

const renders = new Map<string, number>();
let commits = 0;
const counted = (name: string) =>
  renders.set(name, (renders.get(name) ?? 0) + 1);

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

const status = (recordingSessionId: string | null): CvmRecorderMessage => ({
  type: "recorder-status",
  reachable: true,
  starting: false,
  problem: null,
  recordingSessionId,
  streamed: false,
  previews: { camera: "http://r/c", screen: "http://r/s" },
  still: "http://r/still",
});

type Step =
  { kind: "message"; message: CvmRecorderMessage } | { kind: "press-stop" };

/** A Recording Session of TAKES takes, then Stop, then a late replay. */
const stream = (): Step[] => {
  const m = (message: CvmRecorderMessage): Step => ({
    kind: "message",
    message,
  });
  const id = "s1";
  const steps: Step[] = [
    m(status(null)),
    m({ type: "camera-went-live" }),
    m({ type: "scene-changed", scene: "Code" }),
    m({
      type: "recording-started",
      recordingSessionId: id,
      silenceLength: "short",
      micFile: "mic.mkv",
    }),
    m({ type: "warmed-up", recordingSessionId: id }),
  ];
  for (let take = 1; take <= TAKES; take++) {
    const at = take * 10;
    steps.push(m({ type: "speech-started", recordingSessionId: id }));
    steps.push(
      m({
        type: "take-started",
        recordingSessionId: id,
        takeId: `${id}:${take}`,
        startTime: at,
      })
    );
    for (let i = 0; i < STATUS_PER_TAKE; i++) steps.push(m(status(id)));
    for (let i = 0; i < FRAMES_LOST_PER_TAKE; i++)
      steps.push(
        m({
          type: "frames-lost",
          recordingSessionId: id,
          framesLost: { camera: take + i, screen: 0 },
          lostFrameSpans: [
            { picture: "camera", from: at + 8, to: at + 8.1, frames: take + i },
          ],
        })
      );
    steps.push(
      m({
        type: "speech-ended",
        recordingSessionId: id,
        clip: { startTime: at, endTime: at + 5 },
      })
    );
    steps.push(
      m({
        type: "clips-saved",
        recordingSessionId: id,
        clips: [],
        transcriptionJobId: `job-${take}`,
      })
    );
  }
  steps.push({ kind: "press-stop" });
  steps.push(
    m({
      type: "recording-stopped",
      recordingSessionId: id,
      errors: [],
      crashed: false,
      framesLost: { camera: 99, screen: 0 },
      lostFrameSpans: [],
    })
  );
  steps.push(m(status(null)));
  // A late replay of the session just over (#2163): ignored.
  for (let i = 0; i < 5; i++)
    steps.push(m({ type: "speech-started", recordingSessionId: id }));
  return steps;
};

const stepName = (step: Step) =>
  step.kind === "press-stop" ? "press-stop" : step.message.type;

let root: Root | undefined;
let controls: CvmRecorderControls | undefined;
beforeEach(() => {
  renders.clear();
  commits = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ clips: [], transcriptionJobId: null }))
    )
  );
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

const mount = (element: ReactNode) => {
  root = createRoot(document.createElement("div"));
  act(() =>
    root!.render(
      <Profiler id="root" onRender={() => commits++}>
        {element}
      </Profiler>
    )
  );
};

it("counts renders per component for a Recording Session's event stream", async () => {
  mount(<Host />);
  const perStep = new Map<string, Map<string, number>>();
  const startedAt = performance.now();
  for (const step of stream()) {
    const before = new Map(renders);
    const commitsBefore = commits;
    await act(async () => {
      if (step.kind === "press-stop") controls!.onStop();
      else source!.emit(step.message);
    });
    const name = stepName(step);
    const row = perStep.get(name) ?? new Map<string, number>();
    for (const [component, n] of renders)
      row.set(
        component,
        (row.get(component) ?? 0) + n - (before.get(component) ?? 0)
      );
    row.set("(commits)", (row.get("(commits)") ?? 0) + commits - commitsBefore);
    row.set("(events)", (row.get("(events)") ?? 0) + 1);
    perStep.set(name, row);
  }
  const ms = performance.now() - startedAt;
  console.log(
    "RENDER-BENCHMARK " +
      JSON.stringify({
        ms,
        commits,
        renders: Object.fromEntries(renders),
        perStep: Object.fromEntries(
          [...perStep].map(([k, v]) => [k, Object.fromEntries(v)])
        ),
      })
  );
  // The stream did what a Recording Session does: it ended idle.
  expect(isCvmRecorderRecording(controls!.store.getSnapshot())).toBe(false);
});

// Not a benchmark: the app runs under StrictMode, whose remount must leave
// the recorder following the stream and running each effect once.
it("under StrictMode, still follows the recorder and runs each effect once", async () => {
  const clipActions: string[] = [];
  function StrictHost() {
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
        <StrictHost />
      </StrictMode>
    )
  );
  await act(async () => {
    source!.emit(status(null));
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

// ---------------------------------------------------------------------------
// The tree. The recorder is a store; each consumer selects its slice.

function Host() {
  counted("Host (useVideoEditorWiring)");
  // The clip reducer lives here: each clip effect re-renders the host.
  const [, clipDispatch] = useReducer((n: number) => n + 1, 0);
  const recorder = useCvmRecorder({
    video: { id: "v1", format: "landscape" },
    silenceLength: "short",
    clipDispatch: () => clipDispatch(),
    onNewClipOptimisticallyAdded: () => clipDispatch(),
    onClipAudioWindowClosed: () => clipDispatch(),
    micOffsetRefusal: null,
    insertionPoint: () => ({ type: "start" }),
  });
  controls = recorder.controls;
  const capture = captureProps(recorder.capture);
  return <Editor cvmRecorder={recorder.controls} capture={capture} />;
}

function Editor(props: {
  cvmRecorder: CvmRecorderControls;
  capture: ReturnType<typeof captureProps>;
}) {
  counted("VideoEditor");
  const hasLivePreview = useSelector(
    props.cvmRecorder.store,
    getHasLivePreview
  );
  const value = fromPartial<VideoEditorContextType>({
    cvmRecorder: props.cvmRecorder,
    showVideoPlayer: !hasLivePreview,
  });
  return (
    <VideoEditorContext.Provider value={value}>
      <VideoPlayerPanel />
      <LivePreviewFrame />
      <RecorderControls />
      <ShortScreenStatus />
      <CameraProblem />
      <ClipFramePreviewOverlay />
      <NewShortMenuItem />
      {Array.from({ length: CLIPS }, (_, i) => (
        <ClipItem key={i} id={i === CLIPS - 1 ? "s1" : `old-${i}`} />
      ))}
    </VideoEditorContext.Provider>
  );
}

// Each leaf subscribes as its real component does on this branch.

function VideoPlayerPanel() {
  counted("VideoPlayerPanel");
  useCvmRecorderSelector(getHasLivePreview);
  return null;
}

function LivePreviewFrame() {
  counted("LivePreviewFrame");
  useCvmRecorderSelector(getCvmRecorderLivePreview, sameLivePreview);
  useCvmRecorderSelector(stillRound);
  // No last-frame Clip here, so its source is "none".
  useCvmRecorderSelector(() => "none");
  return null;
}

function RecorderControls() {
  counted("CvmRecorderControls");
  useCvmRecorderSelector((s) => s.error);
  useCvmRecorderSelector((s) => s.alert);
  useCvmRecorderSelector((s) => s.phase === "idle");
  useCvmRecorderSelector(framesLostAlert);
  useCvmRecorderSelector((s) => s.framesLost);
  return null;
}

function ShortScreenStatus() {
  counted("ShortScreenStatus");
  useCvmRecorderSelector(screenStatusText);
  return null;
}

function CameraProblem() {
  counted("CameraProblem");
  useCvmRecorderSelector((s) => s.camera);
  return null;
}

function ClipFramePreviewOverlay() {
  counted("ClipFramePreviewOverlay");
  useCvmRecorderSelector(stillRound);
  return null;
}

function NewShortMenuItem() {
  counted("NewShortMenuItem");
  // Reads the recorder only when pressed (`store.getSnapshot()`).
  const recorder = useContextSelector(VideoEditorContext, (c) => c.cvmRecorder);
  void canStop;
  void recorder;
  return null;
}

function ClipItem(props: { id: string }) {
  counted(`ClipItem ×${CLIPS}`);
  const clip = { recordingSession: { id: props.id } };
  useCvmRecorderSelector((s) => holdsStillsOf(s, clip));
  useCvmRecorderSelector(stillRound);
  return null;
}
