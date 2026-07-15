import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOptimisticallyAdded,
  type SessionId,
} from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";

const createInitialState = (
  overrides: Partial<clipStateReducer.State> = {}
): clipStateReducer.State => ({
  clipIdsBeingTranscribed: new Set(),
  items: [],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
  ...overrides,
});

/** Start a recording session and put a page on screen (focused + capturable). */
const startRecordingViewing = (url: string, title = "T") => {
  const tester = new ReducerTester(clipStateReducer, createInitialState());
  tester
    .send({
      type: "recording-started",
      outputPath: "/tmp/rec.mkv",
      silenceLength: "short",
    })
    .send({
      type: "browser-event",
      event: { type: "browser-focus", focused: true, ts: 1000 },
    })
    .send({
      type: "browser-event",
      event: { type: "browser-url", url, title, ts: 1000 },
    });
  return tester;
};

const newClip = (soundDetectionId: string) =>
  fromPartial<clipStateReducer.Action>({
    type: "new-optimistic-clip-detected",
    soundDetectionId,
  });

const optimisticClip = (tester: ReducerTester<any, any, any>, index = 0) =>
  tester.getState().items[index] as ClipOptimisticallyAdded;

const urls = (clip: ClipOptimisticallyAdded) =>
  (clip.pendingWebLinks ?? []).map((l) => l.url);

describe("clipStateReducer — browser link capture", () => {
  it("seeds a new clip with the page on screen when narration begins", () => {
    const tester = startRecordingViewing("https://seed.com", "Seed");
    tester.send(newClip("sound-1"));

    const clip = optimisticClip(tester);
    expect(clip.pendingWebLinks).toEqual([
      {
        url: "https://seed.com",
        title: "Seed",
        capturedAt: expect.any(Number),
      },
    ]);
  });

  it("accumulates the set of pages switched to while the clip records", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester.send(newClip("sound-1")).send({
      type: "browser-event",
      event: {
        type: "browser-url",
        url: "https://b.com",
        title: "B",
        ts: 2000,
      },
    });

    const clip = optimisticClip(tester);
    expect(urls(clip)).toEqual(["https://a.com", "https://b.com"]);
    expect(
      clip.pendingWebLinks!.find((l) => l.url === "https://b.com")
    ).toEqual({ url: "https://b.com", title: "B", capturedAt: 2000 });
  });

  it("dedupes a page shown twice (A, B, A) into one entry, keeping the first sighting", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester
      .send(newClip("sound-1"))
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://b.com",
          title: "B",
          ts: 2000,
        },
      })
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://a.com",
          title: "A",
          ts: 3000,
        },
      });

    const clip = optimisticClip(tester);
    expect(urls(clip)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("ignores unfocused and non-capturable pages, capturing only real web pages", () => {
    const tester = new ReducerTester(clipStateReducer, createInitialState());
    tester
      .send({
        type: "recording-started",
        outputPath: "/tmp/rec.mkv",
        silenceLength: "short",
      })
      // Chrome focused but on an internal page → not capturable, no seed.
      .send({
        type: "browser-event",
        event: { type: "browser-focus", focused: true, ts: 1000 },
      })
      .send({
        type: "browser-event",
        event: { type: "browser-url", url: "chrome://newtab/", ts: 1000 },
      })
      .send(newClip("sound-1"))
      // Chrome loses focus while on a web page → not captured.
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://hidden.com",
          title: "H",
          ts: 1500,
        },
      })
      .send({
        type: "browser-event",
        event: { type: "browser-focus", focused: false, ts: 1600 },
      })
      // Focus returns on a real page → captured.
      .send({
        type: "browser-event",
        event: { type: "browser-focus", focused: true, ts: 2000 },
      });

    const clip = optimisticClip(tester);
    expect(urls(clip)).toEqual(["https://hidden.com"]);
  });

  it("does not capture during the silence gap between clips, and seeds the next clip from the page then visible", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester.send(newClip("sound-1"));
    const sessionId = tester.getState().sessions[0]!.id;

    // First clip's window closes.
    tester.send({
      type: "clip-audio-window-closed",
      sessionId,
      activeDiagramId: null,
      diagramFocused: false,
    });

    // A page shown during the silent gap must not attach to the closed clip.
    tester.send({
      type: "browser-event",
      event: {
        type: "browser-url",
        url: "https://b.com",
        title: "B",
        ts: 5000,
      },
    });
    expect(urls(optimisticClip(tester, 0))).toEqual(["https://a.com"]);

    // The next clip seeds from the page now on screen.
    tester.send(newClip("sound-2"));
    expect(urls(optimisticClip(tester, 1))).toEqual(["https://b.com"]);
  });

  it("stops accumulating to a clip once its audio window has closed", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester.send(newClip("sound-1"));
    const sessionId = tester.getState().sessions[0]!.id;

    tester.send({
      type: "clip-audio-window-closed",
      sessionId,
      activeDiagramId: null,
      diagramFocused: false,
    });
    expect(tester.getState().recordingClipFrontendId).toBeNull();

    tester.send({
      type: "browser-event",
      event: {
        type: "browser-url",
        url: "https://late.com",
        title: "L",
        ts: 9000,
      },
    });
    expect(urls(optimisticClip(tester, 0))).toEqual(["https://a.com"]);
  });

  it("persists the accumulated set when the optimistic clip is paired with a database clip", () => {
    const sessionId = "s-1" as SessionId;
    const tester = new ReducerTester(
      clipStateReducer,
      createInitialState({
        sessions: [
          fromPartial({
            id: sessionId,
            outputPath: "/tmp/r.mkv",
            status: "recording",
          }),
        ],
        items: [
          fromPartial<ClipOptimisticallyAdded>({
            type: "optimistically-added",
            frontendId: "fe-1",
            insertionOrder: 1,
            soundDetectionId: "sound-1",
            sessionId,
            pauseType: "none",
            pendingWebLinks: [
              { url: "https://a.com", title: "A", capturedAt: 1000 },
              { url: "https://b.com", title: "B", capturedAt: 2000 },
            ],
          }),
        ],
      })
    );

    tester.send(
      fromPartial({
        type: "new-database-clips",
        outputPath: "/tmp/r.mkv",
        clips: [{ id: "db-1", diagramSnapshotId: null, pauseType: "none" }],
      })
    );

    const exec = tester.getExec() as any;
    const persistCalls = exec.mock.calls.filter(
      (c: any) => c[0]?.type === "persist-web-links"
    );
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]![0]).toEqual({
      type: "persist-web-links",
      clipId: "db-1",
      links: [
        { url: "https://a.com", title: "A", capturedAt: 1000 },
        { url: "https://b.com", title: "B", capturedAt: 2000 },
      ],
    });
  });
});
