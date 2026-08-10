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
    tester
      .send(newClip("sound-1"))
      // B appears after A has been visible ≥ 1500ms → A promoted (deduped with seed)
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://b.com",
          title: "B",
          ts: 3000,
        },
      })
      // C appears after B has been visible ≥ 1500ms → B promoted
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://c.com",
          title: "C",
          ts: 5000,
        },
      });

    const clip = optimisticClip(tester);
    expect(urls(clip)).toEqual(["https://a.com", "https://b.com"]);
    expect(
      clip.pendingWebLinks!.find((l) => l.url === "https://b.com")
    ).toEqual({ url: "https://b.com", title: "B", capturedAt: 3000 });
  });

  it("dedupes a page shown twice (A, B, A) into one entry, keeping the first sighting", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester
      .send(newClip("sound-1"))
      // B after 1600ms on A → A promoted (deduped with seed)
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://b.com",
          title: "B",
          ts: 2600,
        },
      })
      // A again after 1600ms on B → B promoted
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://a.com",
          title: "A",
          ts: 4200,
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
      // Navigate to a real page while focused.
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://hidden.com",
          title: "H",
          ts: 1500,
        },
      })
      // Chrome loses focus after dwell threshold → captured.
      .send({
        type: "browser-event",
        event: { type: "browser-focus", focused: false, ts: 3500 },
      })
      // Focus returns → starts a new candidate for the same page.
      .send({
        type: "browser-event",
        event: { type: "browser-focus", focused: true, ts: 4000 },
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
      ts: 4000,
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
      ts: 4000,
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

  it("does not capture a page shown for less than the dwell threshold", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester
      .send(newClip("sound-1"))
      // B appears 500ms after A — below the 1500ms dwell threshold
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://b.com",
          title: "B",
          ts: 1500,
        },
      })
      // C appears 300ms after B — also below threshold
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://c.com",
          title: "C",
          ts: 1800,
        },
      });

    const clip = optimisticClip(tester);
    // Only the seed (A) should be captured; B and C were too brief.
    expect(urls(clip)).toEqual(["https://a.com"]);
  });

  it("captures a page at exactly the dwell threshold boundary", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester
      .send(newClip("sound-1"))
      // B appears exactly 1500ms after A → A promoted (deduped with seed)
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://b.com",
          title: "B",
          ts: 2500,
        },
      })
      // C appears exactly 1500ms after B → B promoted
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://c.com",
          title: "C",
          ts: 4000,
        },
      });

    const clip = optimisticClip(tester);
    expect(urls(clip)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("flushes the dwell-time candidate when the clip's audio window closes", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester.send(newClip("sound-1"));
    const sessionId = tester.getState().sessions[0]!.id;

    // Switch to B well after dwell threshold on A
    tester.send({
      type: "browser-event",
      event: {
        type: "browser-url",
        url: "https://b.com",
        title: "B",
        ts: 3000,
      },
    });

    // Close the clip — B has been visible since ts 3000; flushing at ts 4600
    // (≥ 1500ms dwell) promotes it.
    tester.send({
      type: "clip-audio-window-closed",
      sessionId,
      activeDiagramId: null,
      diagramFocused: false,
      ts: 4600,
    });

    const clip = optimisticClip(tester, 0);
    expect(urls(clip)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("does not flush a candidate below the dwell threshold when the clip closes", () => {
    const tester = startRecordingViewing("https://a.com", "A");
    tester.send(newClip("sound-1"));
    const sessionId = tester.getState().sessions[0]!.id;

    // Switch to B at ts 3000
    tester.send({
      type: "browser-event",
      event: {
        type: "browser-url",
        url: "https://b.com",
        title: "B",
        ts: 3000,
      },
    });

    // Close the clip at ts 4000 — only 1000ms since B appeared, below 1500ms threshold
    tester.send({
      type: "clip-audio-window-closed",
      sessionId,
      activeDiagramId: null,
      diagramFocused: false,
      ts: 4000,
    });

    const clip = optimisticClip(tester, 0);
    expect(urls(clip)).toEqual(["https://a.com"]);
  });

  it("filters rapid tab-switching mid-clip, keeping only pages held long enough", () => {
    const tester = startRecordingViewing("https://docs.com", "Docs");
    tester
      .send(newClip("sound-1"))
      // Rapid tab switching — each page < 1500ms
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://mail.com",
          title: "Mail",
          ts: 1200,
        },
      })
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://chat.com",
          title: "Chat",
          ts: 1400,
        },
      })
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://calendar.com",
          title: "Cal",
          ts: 1600,
        },
      })
      // Land on target page and stay
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://target.com",
          title: "Target",
          ts: 1800,
        },
      })
      // Switch away after dwell threshold met on target
      .send({
        type: "browser-event",
        event: {
          type: "browser-url",
          url: "https://other.com",
          title: "Other",
          ts: 4000,
        },
      });

    const clip = optimisticClip(tester);
    // Only docs (seed) and target (held ≥ 1500ms) captured; the brief tabs are filtered
    expect(urls(clip)).toEqual(["https://docs.com", "https://target.com"]);
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
