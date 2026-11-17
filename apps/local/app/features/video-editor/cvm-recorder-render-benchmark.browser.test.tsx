import { fromPartial } from "@total-typescript/shoehorn";
import { act, Profiler, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useContextSelector } from "use-context-selector";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useEffectStore,
  useSelector,
  type EffectStore,
} from "@/hooks/effect-store";
import { FakeEventSource } from "@/test-utils/fake-event-source";
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
 * How much of the editor a Recording Session re-renders. The recorder lives
 * in its effect store (`hooks/effect-store.ts`) and each consumer reads its
 * slice with a selector, so a report that changes nothing a component shows
 * renders nothing (a `recorder-status` every second or so, `frames-lost`
 * outside the controls, a late replay).
 *
 * The tree is the editor's shape: the wiring hook at the top (`Host`, as
 * `useVideoEditorWiring`), `VideoEditor` under it with no `memo`, and the
 * recorder's consumers under that, each subscribing exactly as its real
 * component does. The clip reducer is a store too
 * (`use-video-editor-wiring.ts`): a clip event the recorder sends re-renders
 * `VideoEditor`, which shows the Clips, and not `Host`. Here it is a store
 * that counts them. The counts are deterministic, so they are asserted
 * exactly: a consumer that goes back to reading the whole recorder, or a
 * store that notifies for an ignored event, changes them.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CLIPS = 30;
const HOST = "Host (useVideoEditorWiring)";
const TAKES = 10;
const STATUS_PER_TAKE = 5;
const FRAMES_LOST_PER_TAKE = 3;

// ---------------------------------------------------------------------------
// The harness.

const renders = new Map<string, number>();
let commits = 0;
const counted = (name: string) =>
  renders.set(name, (renders.get(name) ?? 0) + 1);

const recorder = (m: CvmRecorderMessage) =>
  FakeEventSource.at("/api/videos/v1/recorder/events").emit(m.type, m);

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
  FakeEventSource.reset();
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

it("re-renders only what a Recording Session's events change", async () => {
  mount(<Host />);
  const perEvent: Record<
    string,
    { events: number; commits: number; host: number; renders: number }
  > = {};
  const total = () => [...renders.values()].reduce((a, b) => a + b, 0);
  for (const step of stream()) {
    const host = renders.get(HOST) ?? 0;
    const all = total();
    const commitsBefore = commits;
    await act(async () => {
      if (step.kind === "press-stop") controls!.onStop();
      else recorder(step.message);
    });
    const row = (perEvent[stepName(step)] ??= {
      events: 0,
      commits: 0,
      host: 0,
      renders: 0,
    });
    row.events++;
    row.commits += commits - commitsBefore;
    row.host += (renders.get(HOST) ?? 0) - host;
    row.renders += total() - all;
  }

  // The stream did what a Recording Session does: it ended idle.
  expect(isCvmRecorderRecording(controls!.store.getSnapshot())).toBe(false);
  expect(commits).toBe(127);
  expect(Object.fromEntries(renders)).toEqual({
    [HOST]: 40,
    VideoEditor: 51,
    VideoPlayerPanel: 96,
    LivePreviewFrame: 96,
    CvmRecorderControls: 126,
    ShortScreenStatus: 96,
    CameraProblem: 97,
    ClipFramePreviewOverlay: 96,
    NewShortMenuItem: 96,
    [`ClipItem ×${CLIPS}`]: 2880,
  });
  const row = (events: number, commits: number, host: number, all: number) => ({
    events,
    commits,
    host,
    renders: all,
  });
  expect(perEvent).toEqual({
    // Nothing any consumer shows changes: no commit at all.
    "recorder-status": row(52, 0, 0, 0),
    "camera-went-live": row(1, 1, 0, 1),
    "scene-changed": row(1, 2, 0, 75),
    "recording-started": row(1, 4, 3, 154),
    "warmed-up": row(1, 2, 1, 76),
    // 10 takes, then 5 late replays (#2163) that render nothing.
    "speech-started": row(15, 20, 10, 760),
    "take-started": row(10, 20, 10, 760),
    // Only the controls show frames lost.
    "frames-lost": row(30, 30, 0, 30),
    "speech-ended": row(10, 20, 10, 760),
    // Only the clip reducer hears it: VideoEditor re-renders, the host does not.
    "clips-saved": row(10, 20, 0, 750),
    // Stopping changes nothing shown until the recorder says it stopped.
    "press-stop": row(1, 0, 0, 0),
    "recording-stopped": row(1, 4, 3, 154),
  });
});

// ---------------------------------------------------------------------------
// The tree. The recorder is a store; each consumer selects its slice.

function Host() {
  counted(HOST);
  // The clip reducer's store: each clip event changes what VideoEditor shows.
  const clips = useEffectStore(countClipEvents, { events: 0 });
  const clipEvent = () => clips.dispatch({ type: "clip-event" });
  const recorder = useCvmRecorder({
    video: { id: "v1", format: "landscape" },
    silenceLength: "short",
    clipDispatch: clipEvent,
    onNewClipOptimisticallyAdded: clipEvent,
    onClipAudioWindowClosed: clipEvent,
    micOffsetRefusal: null,
    insertionPoint: () => ({ type: "start" }),
  });
  controls = recorder.controls;
  const capture = captureProps(recorder.capture);
  return (
    <Editor cvmRecorder={recorder.controls} capture={capture} clips={clips} />
  );
}

type ClipCount = { events: number };
const countClipEvents = (state: ClipCount): ClipCount => ({
  events: state.events + 1,
});

function Editor(props: {
  cvmRecorder: CvmRecorderControls;
  capture: ReturnType<typeof captureProps>;
  clips: EffectStore<ClipCount, { type: "clip-event" }>;
}) {
  counted("VideoEditor");
  // As the real editor reads `items` and `sessions`.
  useSelector(props.clips, (s) => s.events);
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
