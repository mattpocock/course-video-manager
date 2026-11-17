import { fromPartial } from "@total-typescript/shoehorn";
import { act, Profiler, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { useContextSelector } from "use-context-selector";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UploadProvider } from "@/features/upload-manager/upload-context";
import { FakeEventSource } from "@/test-utils/fake-event-source";
import type { JobEventMessage } from "@/features/jobs/job-wire";
import { JOB_STREAM_EVENTS } from "@/features/jobs/job-wire";
import type { BrowserLinkEvent } from "@/lib/clip-web-link";
import type { VideoEditorLoaderData } from "@/services/video-editor-loader.server";
import type { FrontendId } from "./clip-state-reducer";
import { RecordingSessionPanels } from "./components/recording-session-panel";
import { MissingWordTimingBadge } from "./components/transcript-word-actions";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";
import {
  useVideoEditorWiring,
  type VideoEditorWiring,
} from "./use-video-editor-wiring";
import { VideoEditor } from "./video-editor";
import { VideoEditorContext } from "./video-editor-context";

/**
 * How much of the editor the clip reducer's events re-render. The tree is
 * the edit route's: the real `useVideoEditorWiring` and the real
 * `VideoEditor`, under a router and the Upload provider, with a layout of
 * probes in place of `EditorLayout`. Every event arrives the way it does in
 * the app: Chrome's link capture and the Stream Deck hub over the fake
 * WebSocket, Job Events and the CVM recorder over fake EventSources, and the
 * author's edits through the callbacks the wiring hands the editor. Only the
 * browser's own I/O is faked.
 *
 * The counts are deterministic, so they are asserted exactly: a consumer that
 * goes back to the whole clip state, or a store that notifies for an event
 * that changed nothing shown, changes them.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CLIPS = 20;
const HOST = "EditRoute (useVideoEditorWiring)";
const CLIP_ITEM = `ClipItem ×${CLIPS}`;
const VIDEO_ID = "v1";
/** The loader read the Job Events up to here. */
const JOB_EVENT_CURSOR = 100;

// ---------------------------------------------------------------------------
// The browser's I/O.

const renders = new Map<string, number>();
let commits = 0;
const counted = (name: string) =>
  renders.set(name, (renders.get(name) ?? 0) + 1);

const recorderSource = () =>
  FakeEventSource.at(`/api/videos/${VIDEO_ID}/recorder/events`);
const jobsSource = () => FakeEventSource.at("/api/jobs/events");

/** The Stream Deck hub: the editor's keys and Chrome's link capture. */
const sockets: FakeWebSocket[] = [];
class FakeWebSocket {
  private listeners = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(_url: string) {
    sockets.push(this);
  }
  addEventListener(type: string, listener: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  set onmessage(listener: (e: { data: string }) => void) {
    this.addEventListener("message", listener);
  }
  emit(message: unknown) {
    this.listeners
      .get("message")
      ?.forEach((l) => l({ data: JSON.stringify(message) }));
  }
  send() {}
  close() {}
}

/** One answer serves every request: the clip service's and the recorder's. */
const answer = () =>
  new Response(
    JSON.stringify({
      id: "chapter-db-1",
      clips: [],
      transcriptionJobId: null,
    })
  );

// ---------------------------------------------------------------------------
// The event stream.

type Step = { name: string; run: () => void };

let wiring: VideoEditorWiring | undefined;
/** The editor's timeline, as its context last gave it. */
let timeline: { frontendId: FrontendId }[] = [];

const clipId = (i: number) => timeline[i]!.frontendId;

const browser = (event: BrowserLinkEvent): void =>
  sockets.forEach((s) => s.emit(event));

let jobEventId = 0;
const jobEvent = (
  type: string,
  data: Record<string, unknown>,
  id = ++jobEventId + JOB_EVENT_CURSOR
): void =>
  jobsSource().emit(JOB_STREAM_EVENTS.jobEvent, {
    job: {
      id: "job-1",
      kind: "transcribe-clips",
      title: "Transcribe Clips",
      attempt: 1,
      maxAttempts: 1,
      subjectType: "video",
      subjectId: VIDEO_ID,
      createdAt: "2026-11-17T12:00:00.000Z",
    },
    event: { id, jobId: "job-1", type, data, at: "2026-11-17T12:00:00.000Z" },
  } satisfies JobEventMessage);

const recorder = (message: CvmRecorderMessage): void =>
  recorderSource().emit(message.type, message);

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

const TAKES = 3;

/**
 * An editing visit: Chrome moving between tabs, a Transcription another tab
 * started, the author's edits, then a Recording Session of TAKES takes.
 */
const stream = (): Step[] => {
  const steps: Step[] = [];
  const step = (name: string, run: () => void) => steps.push({ name, run });

  // Chrome's focus and tabs, while nothing records.
  for (let i = 0; i < 6; i++)
    step("browser-url", () =>
      browser({
        type: "browser-url",
        url: `https://example.com/${i}`,
        title: `${i}`,
        ts: 1_000 + i,
      })
    );
  for (let i = 0; i < 4; i++)
    step("browser-focus", () =>
      browser({ type: "browser-focus", focused: i % 2 === 0, ts: 2_000 + i })
    );

  // A Transcription of two Clips, which another tab asked for. Its events
  // from before the loader read are replays.
  for (let i = 1; i <= 5; i++)
    step("job-event (replayed)", () => jobEvent("progress", {}, i));
  step("job-event clips-started", () =>
    jobEvent("clips-started", { clipIds: ["c0", "c1"] })
  );
  for (let i = 0; i < 10; i++)
    step("job-event progress", () => jobEvent("progress", { percent: i }));
  for (const id of ["c0", "c1"])
    step("job-event clip-settled", () =>
      jobEvent("clip-settled", {
        id,
        transcriptionStatus: "done",
        text: `New ${id}`,
        hasTranscriptWords: true,
      })
    );

  // The author's edits.
  step("set-insertion-point", () =>
    wiring!.onSetInsertionPoint("after", clipId(5))
  );
  step("set-insertion-point", () =>
    wiring!.onSetInsertionPoint("before", clipId(2))
  );
  step("toggle-pause-for-clip", () => wiring!.onTogglePauseForClip(clipId(3)));
  step("clip-text-edited", () => wiring!.onEditClipText(clipId(4), "Edited"));
  step("move-clip", () => wiring!.onMoveClip(clipId(6), "down"));
  step("add-chapter", () => wiring!.onAddChapter("Intro"));

  // A Recording Session, with the recorder's status between events.
  const id = "s1";
  step("recorder-status", () => recorder(status(null)));
  step("recording-started", () =>
    recorder({
      type: "recording-started",
      recordingSessionId: id,
      silenceLength: "short",
      micFile: "mic.mkv",
    })
  );
  step("warmed-up", () =>
    recorder({ type: "warmed-up", recordingSessionId: id })
  );
  for (let take = 1; take <= TAKES; take++) {
    const at = take * 10;
    step("speech-started", () =>
      recorder({ type: "speech-started", recordingSessionId: id })
    );
    step("take-started", () =>
      recorder({
        type: "take-started",
        recordingSessionId: id,
        takeId: `${id}:${take}`,
        startTime: at,
      })
    );
    step("recorder-status", () => recorder(status(id)));
    step("browser-url", () =>
      browser({
        type: "browser-url",
        url: `https://example.com/take-${take}`,
        ts: 10_000 * take,
      })
    );
    step("speech-ended", () =>
      recorder({
        type: "speech-ended",
        recordingSessionId: id,
        clip: { startTime: at, endTime: at + 5 },
      })
    );
    step("clips-saved", () =>
      recorder({
        type: "clips-saved",
        recordingSessionId: id,
        clips: [],
        transcriptionJobId: `job-take-${take}`,
      })
    );
  }
  step("recording-stopped", () =>
    recorder({
      type: "recording-stopped",
      recordingSessionId: id,
      errors: [],
      crashed: false,
      framesLost: { camera: 0, screen: 0 },
      lostFrameSpans: [],
    })
  );
  step("recorder-status", () => recorder(status(null)));
  return steps;
};

// ---------------------------------------------------------------------------
// The tree.

type LoadedClip = Extract<
  VideoEditorLoaderData["items"][number],
  { type: "clip" }
>["data"];

const loaderData = (): VideoEditorLoaderData =>
  fromPartial<VideoEditorLoaderData>({
    video: fromPartial({
      id: VIDEO_ID,
      title: "A Video",
      format: "landscape",
      lesson: null,
    }),
    items: Array.from({ length: CLIPS }, (_, i) => ({
      type: "clip" as const,
      data: fromPartial<LoadedClip>({
        id: `c${i}`,
        videoFilename: "footage.mkv",
        sourceStartTime: i * 10,
        sourceEndTime: i * 10 + 5,
        text: `Clip ${i}`,
        transcribedAt: null,
        transcriptionStatus: "done",
        scene: "Camera",
        profile: "Landscape",
        pauseType: "none",
        diagramSnapshotId: null,
        webLinks: [],
      }),
    })),
    clipIdsWithTranscriptWords: Array.from(
      { length: CLIPS },
      (_, i) => `c${i}`
    ),
    jobEventCursor: JOB_EVENT_CURSOR,
    whiteNoiseAssetPath: "/white-noise.mp4",
    lastPassedCalibration: null,
    checkedAtMs: 0,
    fsData: new Promise(() => {}),
    previousVideoClips: [],
    videoCount: 1,
    referenceCandidates: [],
    beats: [],
    animatic: [],
    overlays: [],
    footageNotFound: {},
    previewGainDb: {},
    hasScript: false,
  });

function EditRoute(props: {
  loaderData: VideoEditorLoaderData;
  layout?: () => ReactNode;
}) {
  counted(HOST);
  wiring = useVideoEditorWiring(props.loaderData);
  return (
    <VideoEditor
      {...wiring}
      replay
      layout={props.layout ?? (() => <Layout />)}
    />
  );
}

/** `EditorLayout`'s place: called on every render of `VideoEditor`. */
function Layout() {
  counted("VideoEditor");
  timeline = useContextSelector(VideoEditorContext, (c) => c.items);
  return (
    <>
      <Profiler
        id="MissingWordTimingBadge"
        onRender={() => counted("MissingWordTimingBadge")}
      >
        <MissingWordTimingBadge />
      </Profiler>
      {Array.from({ length: CLIPS }, (_, i) => (
        <ClipItem key={i} index={i} />
      ))}
    </>
  );
}

/** A Clip's row: it reads its Clip from the editor's timeline. */
function ClipItem(props: { index: number }) {
  counted(CLIP_ITEM);
  useContextSelector(VideoEditorContext, (c) => c.items[props.index]);
  return null;
}

// ---------------------------------------------------------------------------

let root: Root | undefined;
let container: HTMLElement | undefined;
beforeEach(() => {
  renders.clear();
  commits = 0;
  FakeEventSource.reset();
  sockets.length = 0;
  jobEventId = 0;
  localStorage.clear();
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => answer())
  );
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  wiring = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = async (element: ReactNode) => {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <UploadProvider>
          <Profiler id="editor" onRender={() => commits++}>
            {element}
          </Profiler>
        </UploadProvider>
      ),
    },
  ]);
  // In the document, so an effect that looks the DOM up finds the editor.
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<RouterProvider router={router} />));
};

it("re-renders only what the clip reducer's events change", async () => {
  await mount(<EditRoute loaderData={loaderData()} />);
  // Count the stream only, not the mount.
  renders.clear();
  commits = 0;

  const perEvent: Record<
    string,
    { events: number; commits: number; host: number; renders: number }
  > = {};
  const total = () => [...renders.values()].reduce((a, b) => a + b, 0);
  for (const step of stream()) {
    const host = renders.get(HOST) ?? 0;
    const all = total();
    const commitsBefore = commits;
    await act(async () => step.run());
    const row = (perEvent[step.name] ??= {
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

  // The stream did what an editing visit does: no error overlay, and the
  // new chapter is on the timeline.
  expect(container!.textContent).toBe("");
  expect(timeline).toHaveLength(CLIPS + 1);

  expect(commits).toBe(79);
  expect(Object.fromEntries(renders)).toEqual({
    [HOST]: 16,
    VideoEditor: 58,
    MissingWordTimingBadge: 58,
    [CLIP_ITEM]: 1160,
  });
  const row = (events: number, commits: number, host: number, all: number) => ({
    events,
    commits,
    host,
    renders: all,
  });
  expect(perEvent).toEqual({
    // Nothing the editor shows changes: no commit at all.
    "browser-url": row(9, 0, 0, 0),
    "browser-focus": row(4, 0, 0, 0),
    "job-event (replayed)": row(5, 0, 0, 0),
    "job-event progress": row(10, 0, 0, 0),
    "recorder-status": row(5, 0, 0, 0),
    // A save that brought no Clips rebuilt the list, entry for entry.
    "clips-saved": row(3, 0, 0, 0),
    // The editor shows these; the route never re-renders for one.
    "job-event clips-started": row(1, 4, 0, 66),
    "job-event clip-settled": row(2, 8, 0, 132),
    "set-insertion-point": row(2, 8, 0, 132),
    "toggle-pause-for-clip": row(1, 3, 0, 44),
    "clip-text-edited": row(1, 3, 0, 44),
    "move-clip": row(1, 4, 0, 66),
    "add-chapter": row(1, 6, 0, 110),
    // The route re-renders for what the recorder hands it (recording, speech).
    "recording-started": row(1, 5, 3, 91),
    "warmed-up": row(1, 3, 1, 45),
    "speech-started": row(3, 9, 3, 135),
    "take-started": row(3, 12, 3, 201),
    "speech-ended": row(3, 9, 3, 135),
    "recording-stopped": row(1, 5, 3, 91),
  });
});

it("under StrictMode, runs each clip effect once", async () => {
  await mount(
    <StrictMode>
      <EditRoute loaderData={loaderData()} />
    </StrictMode>
  );
  await act(async () => wiring!.onAddChapter("Intro"));
  await act(async () => wiring!.onEditClipText(clipId(4), "Edited"));

  const sent = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => url === "/api/clip-service")
    .map(
      ([, init]) => (JSON.parse(String(init?.body)) as { type: string }).type
    );
  expect(sent).toEqual([
    "create-chapter-at-insertion-point",
    "update-clip-text",
  ]);
});

// The store starts `scroll-to-insertion-point` before React renders the new
// Session, and its panel (`RecordingSessionPanels`) reads `sessionPanels`
// from the editor's context, which use-context-selector delivers a pass
// after the commit. So the handler waits a frame.
it("scrolls to a Session's panel once it is on screen", async () => {
  const scrolled: Element[] = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element
  ) {
    scrolled.push(this);
  });
  // The editor's real Session panels, as `EditorLayout` places them.
  await mount(
    <EditRoute
      loaderData={loaderData()}
      layout={() => <RecordingSessionPanels />}
    />
  );
  await act(async () => {
    recorder({
      type: "recording-started",
      recordingSessionId: "s1",
      silenceLength: "short",
      micFile: "mic.mkv",
    });
    await new Promise((frame) => requestAnimationFrame(frame));
  });

  expect(scrolled).toHaveLength(1);
  expect(scrolled[0]!.hasAttribute("data-session-recording")).toBe(true);
});
