import { describe, expect, it } from "vitest";
import { makeVideoEditorReducer } from "./video-state-reducer";
import type { videoStateReducer } from "./video-state-reducer";
import type { FrontendId } from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";

const createInitialState = (
  overrides: Partial<videoStateReducer.State> = {}
): videoStateReducer.State => ({
  clipIdsPreloaded: new Set(),
  runningState: "paused",
  currentClipId: undefined,
  currentTimeInClip: 0,
  selectedClipsSet: new Set(),
  playbackRate: 1,
  showLastFrameOfVideo: false,
  scrubSeekTime: undefined,
  animatic: null,
  ...overrides,
});

describe("videoStateReducer", () => {
  it("a Clip Mockup clicked mid-Take stops the editor and the Take, and the Animatic player owns the keys until it is dismissed", () => {
    const clip = "clip-1" as FrontendId;
    const tester = new ReducerTester(
      makeVideoEditorReducer([clip], [clip]),
      createInitialState({ currentClipId: clip, runningState: "playing" })
    );

    tester.send({
      type: "click-animatic-clip-mockup",
      clipMockupId: "mockup-14",
      takeRecording: true,
    });
    expect(tester.getState()).toMatchObject({
      runningState: "paused",
      animatic: { clipMockupId: "mockup-14" },
    });

    // SPACE is the Animatic's while it is open: the editor stays paused.
    tester.send({ type: "press-space-bar" }).send({ type: "press-l" });
    expect(tester.getState().runningState).toBe("paused");

    tester.send({ type: "dismiss-animatic" }).send({ type: "press-space-bar" });
    expect(tester.getState()).toMatchObject({
      animatic: null,
      runningState: "playing",
    });
    expect(tester.getEffects()).toEqual([{ type: "stop-recording" }]);
  });

  it("keeps only the Clips around the playhead preloaded, however many have played", () => {
    const clips = Array.from(
      { length: 10 },
      (_, i) => `clip-${i}` as FrontendId
    );
    const tester = new ReducerTester(
      makeVideoEditorReducer(clips, clips),
      createInitialState({ currentClipId: clips[0], runningState: "playing" })
    );
    for (let i = 0; i < 7; i++) tester.send({ type: "clip-finished" });

    expect([...tester.getState().clipIdsPreloaded]).toEqual([
      "clip-7",
      "clip-8",
      "clip-9",
    ]);
  });

  it("a dot clicked on the teleprompter plays its Clip, and pauses it when clicked again", () => {
    const clip1 = "clip-1" as FrontendId;
    const clip2 = "clip-2" as FrontendId;
    const reducer = makeVideoEditorReducer([clip1, clip2], [clip1, clip2]);
    const tester = new ReducerTester(
      reducer,
      createInitialState({ currentClipId: clip1, currentTimeInClip: 3 })
    );

    const playing = tester
      .send({ type: "click-teleprompter-mark", clipId: clip2 })
      .getState();
    expect(playing).toMatchObject({
      currentClipId: clip2,
      runningState: "playing",
      currentTimeInClip: 0,
    });

    const paused = tester
      .send({ type: "click-teleprompter-mark", clipId: clip2 })
      .getState();
    expect(paused).toMatchObject({
      currentClipId: clip2,
      runningState: "paused",
    });

    // A mark whose Clip has left the timeline does nothing.
    const gone = "clip-gone" as FrontendId;
    expect(
      tester.send({ type: "click-teleprompter-mark", clipId: gone }).getState()
    ).toBe(paused);
  });

  it("a playing Clip that leaves the timeline stops playing, so the teleprompter never shows a deleted Clip as playing", () => {
    const clip1 = "clip-1" as FrontendId;
    const clip2 = "clip-2" as FrontendId;
    const reducer = makeVideoEditorReducer([clip1, clip2], [clip1, clip2]);
    const tester = new ReducerTester(
      reducer,
      createInitialState({ currentClipId: clip1 })
    );

    // A Stream Deck delete archives the playing Clip; the timeline drops it.
    const state = tester
      .send({ type: "click-teleprompter-mark", clipId: clip2 })
      .send({ type: "timeline-clips-changed", clipIds: [clip1] })
      .getState();
    expect(state.runningState).toBe("paused");
    expect(state.currentClipId).toBeUndefined();

    // Playing again cannot bring the deleted Clip back.
    expect(
      tester.send({ type: "press-space-bar" }).getState().currentClipId
    ).toBeUndefined();
    expect(tester.getEffects()).toEqual([]);
  });

  describe("shift-click multi-select", () => {
    it("should select range from section header to clip when shift-clicking", () => {
      const sectionId = "section-1" as FrontendId;
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;
      const clip3 = "clip-3" as FrontendId;

      const itemIds = [clip1, sectionId, clip2, clip3];
      const clipIds = [clip1, clip2, clip3];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      // Start with section header selected
      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: new Set([sectionId]),
          currentClipId: clip1,
        })
      );

      // Shift-click clip3
      const state = tester
        .send({
          type: "click-clip",
          clipId: clip3,
          ctrlKey: false,
          shiftKey: true,
        })
        .getState();

      // Should select everything from sectionId to clip3
      expect(state.selectedClipsSet).toEqual(
        new Set([sectionId, clip2, clip3])
      );
    });

    it("should select range from clip to section header when shift-clicking", () => {
      const clip1 = "clip-1" as FrontendId;
      const sectionId = "section-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;

      const itemIds = [clip1, sectionId, clip2];
      const clipIds = [clip1, clip2];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      // Start with clip2 selected
      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: new Set([clip2]),
          currentClipId: clip1,
        })
      );

      // Shift-click clip1 (backwards selection)
      const state = tester
        .send({
          type: "click-clip",
          clipId: clip1,
          ctrlKey: false,
          shiftKey: true,
        })
        .getState();

      // Should select everything from clip1 to clip2, including the section
      expect(state.selectedClipsSet).toEqual(
        new Set([clip1, sectionId, clip2])
      );
    });

    it("should select range between two clips (no sections involved)", () => {
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;
      const clip3 = "clip-3" as FrontendId;

      const itemIds = [clip1, clip2, clip3];
      const clipIds = [clip1, clip2, clip3];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: new Set([clip1]),
          currentClipId: clip1,
        })
      );

      const state = tester
        .send({
          type: "click-clip",
          clipId: clip3,
          ctrlKey: false,
          shiftKey: true,
        })
        .getState();

      expect(state.selectedClipsSet).toEqual(new Set([clip1, clip2, clip3]));
    });
  });

  describe("scrub-to-time", () => {
    it("should pause playback and set scrubSeekTime", () => {
      const clip1 = "clip-1" as FrontendId;

      const itemIds = [clip1];
      const clipIds = [clip1];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const tester = new ReducerTester(
        reducer,
        createInitialState({
          currentClipId: clip1,
          runningState: "playing",
        })
      );

      const state = tester
        .send({
          type: "scrub-to-time",
          time: 5.5,
        })
        .getState();

      expect(state.runningState).toBe("paused");
      expect(state.scrubSeekTime).toBe(5.5);
    });

    it("should clear scrubSeekTime when pressing play", () => {
      const clip1 = "clip-1" as FrontendId;

      const itemIds = [clip1];
      const clipIds = [clip1];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const tester = new ReducerTester(
        reducer,
        createInitialState({
          currentClipId: clip1,
          runningState: "paused",
          scrubSeekTime: 5.5,
        })
      );

      const state = tester
        .send({
          type: "press-space-bar",
        })
        .getState();

      expect(state.runningState).toBe("playing");
      expect(state.scrubSeekTime).toBeUndefined();
    });

    it("should clear scrubSeekTime when clicking a different clip", () => {
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;

      const itemIds = [clip1, clip2];
      const clipIds = [clip1, clip2];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const tester = new ReducerTester(
        reducer,
        createInitialState({
          currentClipId: clip1,
          runningState: "paused",
          scrubSeekTime: 5.5,
          selectedClipsSet: new Set([clip1]),
        })
      );

      const state = tester
        .send({
          type: "click-clip",
          clipId: clip2,
          ctrlKey: false,
          shiftKey: false,
        })
        .getState();

      expect(state.scrubSeekTime).toBeUndefined();
    });

    it("should clear scrubSeekTime when clip finishes (auto-advance)", () => {
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;

      const itemIds = [clip1, clip2];
      const clipIds = [clip1, clip2];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const tester = new ReducerTester(
        reducer,
        createInitialState({
          currentClipId: clip1,
          runningState: "playing",
          scrubSeekTime: 3.0,
        })
      );

      const state = tester
        .send({
          type: "clip-finished",
        })
        .getState();

      expect(state.scrubSeekTime).toBeUndefined();
    });
  });

  describe("create-video-from-selection-confirmed", () => {
    it("should separate clip IDs and chapter IDs in the effect payload", () => {
      const clip1 = "clip-1" as FrontendId;
      const section1 = "section-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;

      const itemIds = [clip1, section1, clip2];
      const clipIds = [clip1, clip2]; // Only clips, not sections

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: new Set([clip1, section1, clip2]),
          currentClipId: clip1,
        })
      );

      tester.send({
        type: "create-video-from-selection-confirmed",
        title: "Mixed Selection Video",
        mode: "copy",
      });

      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "create-video-from-selection",
        clipIds: [clip1, clip2],
        chapterIds: [section1],
        title: "Mixed Selection Video",
        mode: "copy",
      });
    });

    it("should not modify timeline state in copy mode (items remain in place)", () => {
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;

      const itemIds = [clip1, clip2];
      const clipIds = [clip1, clip2];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const initialSelectedSet = new Set([clip1, clip2]);
      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: initialSelectedSet,
          currentClipId: clip1,
        })
      );

      const state = tester
        .send({
          type: "create-video-from-selection-confirmed",
          title: "Copy Mode Video",
          mode: "copy",
        })
        .getState();

      // In copy mode, selected items should remain selected (no optimistic removal)
      expect(state.selectedClipsSet).toEqual(new Set([clip1, clip2]));
    });

    it("should clear selection and ask for a move in move mode (optimistic removal)", () => {
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;
      const clip3 = "clip-3" as FrontendId;

      const itemIds = [clip1, clip2, clip3];
      const clipIds = [clip1, clip2, clip3];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: new Set([clip1, clip2]),
          currentClipId: clip1,
        })
      );

      const state = tester
        .send({
          type: "create-video-from-selection-confirmed",
          title: "Move Mode Video",
          mode: "move",
        })
        .getState();

      // In move mode, selection should be cleared (items are being moved away)
      expect(state.selectedClipsSet).toEqual(new Set());
      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "create-video-from-selection",
        clipIds: [clip1, clip2],
        chapterIds: [],
        title: "Move Mode Video",
        mode: "move",
      });
    });
  });

  describe("re-transcribing a whole video's clips (#1571)", () => {
    it("asks for exactly the clips it was given, in one effect", () => {
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;
      const tester = new ReducerTester(
        makeVideoEditorReducer([clip1, clip2], [clip1, clip2]),
        createInitialState()
      );

      tester.send({ type: "retranscribe-clips", clipIds: [clip1, clip2] });

      expect(tester.getExec()).toHaveBeenCalledExactlyOnceWith({
        type: "retranscribe-clips",
        clipIds: [clip1, clip2],
      });
    });

    it("does nothing for a video with no transcribable clip", () => {
      const tester = new ReducerTester(
        makeVideoEditorReducer([], []),
        createInitialState()
      );

      tester.send({ type: "retranscribe-clips", clipIds: [] });

      expect(tester.getExec()).not.toHaveBeenCalled();
    });

    it("leaves playback alone — a re-transcribe is not a timeline edit", () => {
      const clip1 = "clip-1" as FrontendId;
      const tester = new ReducerTester(
        makeVideoEditorReducer([clip1], [clip1]),
        createInitialState({ runningState: "playing", currentClipId: clip1 })
      );

      const state = tester
        .send({ type: "retranscribe-clips", clipIds: [clip1] })
        .getState();

      expect(state.runningState).toBe("playing");
      expect(state.currentClipId).toBe(clip1);
    });
  });
});
