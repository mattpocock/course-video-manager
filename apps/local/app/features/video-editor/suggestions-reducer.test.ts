import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  ALL_SOURCES_INCLUDED,
  createInitialSuggestionsState,
  getSteerInEffect,
  getTeleprompterSuggestion,
  suggestionsStateReducer,
  type suggestionsReducer,
} from "./suggestions-reducer";

const context = (
  overrides: Partial<suggestionsReducer.EditorContext> = {}
): suggestionsReducer.EditorContext => ({
  animatic: 'Mockup 1: "Hello"',
  beats: "",
  clips: ["So that's a type."],
  transcribedClipIds: ["c1"],
  diagramSnapshotId: null,
  insertionAnchor: "c1",
  previousItems: { c1: null },
  ...overrides,
});

/** The running stream, as `exec` hands it back, so stopping it is visible. */
const runningStream = { stop: () => {} } as never;

const tester = (
  pickedFiles: string[] = [],
  previousVideoClips: string[] = []
) => {
  const t = new ReducerTester(
    suggestionsStateReducer,
    createInitialSuggestionsState({
      videoId: "v1",
      included: ALL_SOURCES_INCLUDED,
      pickedFiles,
      previousVideoClips,
    })
  );
  vi.mocked(t.getExec()).mockReturnValue(runningStream);
  return t.send({ type: "editor-context-changed", context: context() });
};

const stream = (
  requestId: number,
  input: Partial<
    suggestionsReducer.Effect & { type: "stream-suggestion" }
  >["input"]
) => ({ type: "stream-suggestion", requestId, videoId: "v1", input });

/** The Suggestion so far, as the stream reports it. */
const chunk = (requestId: number, text: string) => ({
  type: "suggestion-chunk-received" as const,
  requestId,
  text,
});

describe("the Suggestions tab", () => {
  it("does nothing while closed, even when a new transcript arrives", () => {
    const t = tester().send({
      type: "editor-context-changed",
      context: context({ transcribedClipIds: ["c1", "c2"] }),
    });
    expect(t.getEffects()).toEqual([]);
    expect(getTeleprompterSuggestion(t.getState())).toBeNull();
  });

  it("opening loads the Script, then streams a suggestion from the sources the video has", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "Intro line." })
      .send(chunk(1, "Now"))
      .send(chunk(1, "Now try it."))
      .send({ type: "suggestion-finished", requestId: 1 });

    expect(t.getEffects()).toEqual([
      { type: "load-script", videoId: "v1" },
      stream(1, {
        script: "Intro line.",
        animatic: 'Mockup 1: "Hello"',
        clips: ["So that's a type."],
      }),
    ]);
    expect(t.getState().status).toBe("done");
    expect(getTeleprompterSuggestion(t.getState())).toEqual({
      id: 1,
      text: "Now try it.",
      previousClips: ["So that's a type."],
    });
  });

  it("a stream that ends with nothing said is a failure", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .send({ type: "suggestion-finished", requestId: 1 });
    expect(t.getState().status).toBe("failed");
    expect(getTeleprompterSuggestion(t.getState())).toBeNull();
  });

  it("a new Clip's transcript supersedes the suggestion in flight", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .send(chunk(1, "Old"))
      .send({
        type: "editor-context-changed",
        context: context({
          clips: ["So that's a type.", "And here's another."],
          transcribedClipIds: ["c1", "c2"],
        }),
      })
      // The superseded stream's late words are ignored.
      .send(chunk(1, "Old words"));

    expect(t.getExec().stop).toHaveBeenCalledWith(runningStream);
    expect(t.getEffects().at(-1)).toEqual(
      stream(2, {
        animatic: 'Mockup 1: "Hello"',
        clips: ["So that's a type.", "And here's another."],
      })
    );
    expect(getTeleprompterSuggestion(t.getState())).toMatchObject({
      id: 2,
      text: "",
    });
  });

  it("a Clip deleted, moved or re-transcribed, or the Insertion Point moved, asks again at once", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .resetExec();
    vi.mocked(t.getExec()).mockReturnValue(runningStream);
    // No new transcript, but the Clips before the Insertion Point changed.
    t.send({ type: "editor-context-changed", context: context({ clips: [] }) })
      // The same input again: nothing to ask.
      .send({ type: "editor-context-changed", context: context({ clips: [] }) })
      // A change to an unticked source sends the same request.
      .send({ type: "source-toggled", source: "beats" })
      .send({
        type: "editor-context-changed",
        context: context({ clips: [], beats: "Hook" }),
      });

    expect(t.getExec().stop).toHaveBeenCalledWith(runningStream);
    expect(t.getEffects()).toEqual([
      stream(2, { animatic: 'Mockup 1: "Hello"', clips: [] }),
      {
        type: "store-included-sources",
        included: { ...ALL_SOURCES_INCLUDED, beats: false },
      },
      stream(3, { animatic: 'Mockup 1: "Hello"', clips: [] }),
    ]);
  });

  it("reopening asks at once with the Script in hand, and again only if the reloaded Script changed", () => {
    const t = tester()
      .send({ type: "script-loaded", videoId: "v1", script: "Intro." })
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "Intro." })
      .send({ type: "suggestions-tab-closed" })
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "New intro." });

    const asked = {
      animatic: 'Mockup 1: "Hello"',
      clips: ["So that's a type."],
    };
    expect(t.getEffects()).toEqual([
      { type: "load-script", videoId: "v1" },
      stream(1, { script: "Intro.", ...asked }),
      { type: "load-script", videoId: "v1" },
      stream(2, { script: "Intro.", ...asked }),
      stream(3, { script: "New intro.", ...asked }),
    ]);
  });

  it("sends every Clip, shows the last three on the glass, and closes bold still streaming in", () => {
    const clips = ["one", "two", "three", "four"];
    const t = tester()
      .send({
        type: "editor-context-changed",
        context: context({ clips }),
      })
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .send(chunk(1, "Now the **important"));

    expect(t.getEffects().at(-1)).toEqual(
      stream(1, { animatic: 'Mockup 1: "Hello"', clips })
    );
    expect(getTeleprompterSuggestion(t.getState())).toEqual({
      id: 1,
      text: "Now the **important**",
      previousClips: ["two", "three", "four"],
    });
  });

  it("an unticked source is left out, and the choice is stored", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "Intro line." })
      .resetExec()
      .send({ type: "source-toggled", source: "animatic" });

    expect(t.getEffects()).toEqual([
      {
        type: "store-included-sources",
        included: { ...ALL_SOURCES_INCLUDED, animatic: false },
      },
      stream(2, { script: "Intro line.", clips: ["So that's a type."] }),
    ]);
  });

  it("closing stops the stream and hands the teleprompter back to the Script", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .send(chunk(1, "Half"))
      .send({ type: "suggestions-tab-closed" })
      .send({
        type: "editor-context-changed",
        context: context({ transcribedClipIds: ["c1", "c2"] }),
      });

    expect(t.getExec().stop).toHaveBeenCalledWith(runningStream);
    expect(t.getEffects()).toHaveLength(2);
    expect(getTeleprompterSuggestion(t.getState())).toBeNull();
  });

  it("the on-screen Diagram's new text asks once editing pauses; unticked, it waits for nothing", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .resetExec();
    vi.mocked(t.getExec()).mockReturnValue(runningStream);
    t.send({ type: "diagram-text-changed", text: "Client" })
      .send({ type: "diagram-text-changed", text: "Client Server" })
      // The heartbeat repeats the text: not an edit.
      .send({ type: "diagram-text-changed", text: "Client Server" })
      // The first pause was superseded by the second edit.
      .send({ type: "edit-pause-elapsed", editId: 1 })
      .send({ type: "edit-pause-elapsed", editId: 2 })
      .send({ type: "source-toggled", source: "diagram" })
      .send({ type: "diagram-text-changed", text: "Client Server DB" });

    expect(t.getEffects()).toEqual([
      { type: "wait-for-edit-pause", editId: 1 },
      { type: "wait-for-edit-pause", editId: 2 },
      stream(2, {
        animatic: 'Mockup 1: "Hello"',
        diagram: "Client Server",
        clips: ["So that's a type."],
      }),
      {
        type: "store-included-sources",
        included: { ...ALL_SOURCES_INCLUDED, diagram: false },
      },
      stream(3, {
        animatic: 'Mockup 1: "Hello"',
        clips: ["So that's a type."],
      }),
    ]);
  });

  it("names the DiagramSnapshot on the Clip before the Insertion Point only when it sends the Diagram", () => {
    const t = tester()
      .send({
        type: "editor-context-changed",
        context: context({ diagramSnapshotId: "snap-1" }),
      })
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .send({ type: "refresh-clicked" })
      .send({ type: "diagram-text-changed", text: "Client\nServer" })
      .send({ type: "edit-pause-elapsed", editId: 1 });

    const streams = t
      .getEffects()
      .filter((effect) => effect.type === "stream-suggestion");
    expect(streams.at(-2)).toEqual(
      stream(2, {
        animatic: 'Mockup 1: "Hello"',
        clips: ["So that's a type."],
      })
    );
    expect(streams.at(-1)).toEqual(
      stream(3, {
        animatic: 'Mockup 1: "Hello"',
        diagram: "Client\nServer",
        diagramSnapshotId: "snap-1",
        clips: ["So that's a type."],
      })
    );
  });

  it("sends the previous Video's Clips until 5 Clips are before the Insertion Point, then follows the tick again below that", () => {
    const four = ["a", "b", "c", "d"];
    const t = tester([], ["Last time.", "See you next."])
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .send({
        type: "editor-context-changed",
        context: context({ clips: four }),
      })
      .send({
        type: "editor-context-changed",
        context: context({ clips: [...four, "e"] }),
      })
      .send({
        type: "editor-context-changed",
        context: context({ clips: four }),
      });

    const sent = t
      .getEffects()
      .flatMap((effect) =>
        effect.type === "stream-suggestion" ? [effect.input.previousVideo] : []
      );
    expect(sent.slice(-3)).toEqual([
      "Last time.\nSee you next.",
      undefined,
      "Last time.\nSee you next.",
    ]);
    expect(t.getState().included.previousVideo).toBe(true);
  });

  describe("repo files picked in the Context modal", () => {
    const repoFiles = [
      { path: "src/index.ts", size: 400 },
      { path: "README.md", size: 80 },
    ];

    const opened = (pickedFiles: string[] = []) => {
      const t = tester(pickedFiles)
        .send({ type: "repo-files-listed", videoId: "v1", files: repoFiles })
        .send({ type: "suggestions-tab-opened" })
        .send({ type: "script-loaded", videoId: "v1", script: "" })
        .resetExec();
      vi.mocked(t.getExec()).mockReturnValue(runningStream);
      return t;
    };

    it("ticking a file stores the pick for this Video and asks again with it at once", () => {
      const t = opened()
        .send({ type: "context-button-clicked" })
        .send({ type: "repo-files-picked", paths: ["src/index.ts"] })
        .send({
          type: "repo-files-picked",
          paths: ["src/index.ts", "README.md"],
        });

      expect(t.getState().contextModalOpen).toBe(true);
      expect(t.getEffects()).toEqual([
        { type: "store-picked-files", videoId: "v1", paths: ["src/index.ts"] },
        stream(2, {
          animatic: 'Mockup 1: "Hello"',
          clips: ["So that's a type."],
          files: ["src/index.ts"],
        }),
        {
          type: "store-picked-files",
          videoId: "v1",
          paths: ["README.md", "src/index.ts"],
        },
        stream(3, {
          animatic: 'Mockup 1: "Hello"',
          clips: ["So that's a type."],
          files: ["README.md", "src/index.ts"],
        }),
      ]);
      expect(t.getExec().stop).toHaveBeenCalledWith(runningStream);
    });

    it("a Video's stored pick is sent from the first suggestion", () => {
      const t = tester(["README.md"])
        .send({ type: "repo-files-listed", videoId: "v1", files: repoFiles })
        .send({ type: "suggestions-tab-opened" })
        .send({ type: "script-loaded", videoId: "v1", script: "" });

      expect(t.getEffects()).toEqual([
        { type: "load-script", videoId: "v1" },
        stream(1, {
          animatic: 'Mockup 1: "Hello"',
          clips: ["So that's a type."],
          files: ["README.md"],
        }),
      ]);
    });

    it("a picked file the Video no longer has is not sent, but stays picked", () => {
      const t = opened(["gone.ts", "README.md"]).send({
        type: "refresh-clicked",
      });

      expect(t.getEffects()).toEqual([
        stream(2, {
          animatic: 'Mockup 1: "Hello"',
          clips: ["So that's a type."],
          files: ["README.md"],
        }),
      ]);
      expect(t.getState().pickedFiles).toEqual(["gone.ts", "README.md"]);
    });

    it("closing the modal keeps the pick and asks nothing", () => {
      const t = opened(["README.md"])
        .send({ type: "context-button-clicked" })
        .send({ type: "context-modal-dismissed" });

      expect(t.getState().contextModalOpen).toBe(false);
      expect(t.getState().pickedFiles).toEqual(["README.md"]);
      expect(t.getEffects()).toEqual([]);
    });
  });

  it("a Video that opens on the tab asks nothing and keeps the Script until Refresh; clicking the tab open still asks", () => {
    const t = new ReducerTester(
      suggestionsStateReducer,
      createInitialSuggestionsState({
        videoId: "v1",
        included: ALL_SOURCES_INCLUDED,
        pickedFiles: [],
        openedOnTab: true,
      })
    );
    vi.mocked(t.getExec()).mockReturnValue(runningStream);
    t.send({ type: "editor-context-changed", context: context() })
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "Intro line." })
      .send({
        type: "editor-context-changed",
        context: context({ transcribedClipIds: ["c1", "c2"] }),
      });
    expect(
      t.getEffects().filter((e) => e.type === "stream-suggestion")
    ).toEqual([]);
    expect(getTeleprompterSuggestion(t.getState())).toBeNull();

    t.send({ type: "refresh-clicked" });
    expect(t.getEffects().at(-1)).toMatchObject({
      type: "stream-suggestion",
      requestId: 1,
    });

    // Closed and clicked open again: asks at once, as ever.
    t.resetExec()
      .send({ type: "suggestions-tab-closed" })
      .send({ type: "suggestions-tab-opened" });
    expect(t.getEffects().at(-1)).toMatchObject({
      type: "stream-suggestion",
      requestId: 2,
    });
  });

  it("brings one Suggestion, its text alone on the teleprompter; Refresh replaces it", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .send(chunk(1, "Follow the plan."))
      .send({ type: "suggestion-finished", requestId: 1 });

    expect(getTeleprompterSuggestion(t.getState())).toEqual({
      id: 1,
      text: "Follow the plan.",
      previousClips: ["So that's a type."],
    });

    t.send({ type: "refresh-clicked" }).send(chunk(2, "Fresh plan."));
    expect(getTeleprompterSuggestion(t.getState())).toEqual({
      id: 2,
      text: "Fresh plan.",
      previousClips: ["So that's a type."],
    });
  });

  describe("a Steer", () => {
    const opened = () => {
      const t = tester()
        .send({ type: "suggestions-tab-opened" })
        .send({ type: "script-loaded", videoId: "v1", script: "" })
        .resetExec();
      vi.mocked(t.getExec()).mockReturnValue(runningStream);
      return t;
    };

    const steer = (t: ReturnType<typeof opened>, text: string) =>
      t
        .send({ type: "steer-button-clicked" })
        .send({ type: "steer-draft-edited", text })
        .send({ type: "steer-submitted" });

    const asked = (t: ReturnType<typeof opened>) =>
      t
        .getEffects()
        .flatMap((e) =>
          e.type === "stream-suggestion" ? [e.input.steer] : []
        );

    it("guides the next Suggestion at once; giving it again at the same Insertion Point edits it, and clearing it asks without", () => {
      const t = steer(opened(), "Show the error next");
      expect(getSteerInEffect(t.getState())?.text).toBe("Show the error next");
      expect(t.getState().steerDraft).toBeNull();

      // The button opens the draft on the Steer in effect.
      t.send({ type: "steer-button-clicked" });
      expect(t.getState().steerDraft).toBe("Show the error next");
      t.send({ type: "steer-draft-edited", text: "Show the fix next" }).send({
        type: "steer-submitted",
      });
      expect(t.getState().steers).toHaveLength(1);

      t.send({ type: "steer-cleared" });
      expect(getSteerInEffect(t.getState())).toBeUndefined();
      expect(asked(t)).toEqual([
        "Show the error next",
        "Show the fix next",
        undefined,
      ]);
    });

    it("is used up by the Clip recorded at its Insertion Point once its transcript arrives, and comes back when that Clip is deleted", () => {
      const t = steer(opened(), "Show the error next");
      const sent = () => asked(t).at(-1);
      const clips = ["So that's a type."];

      // Recording: the Clip is on the timeline, the Insertion Point after it.
      t.send({
        type: "editor-context-changed",
        context: context({
          insertionAnchor: "c2",
          previousItems: { c1: null, c2: "c1" },
        }),
      });
      expect(getSteerInEffect(t.getState())).toBeUndefined();

      // Its transcript arrives: it is accepted, and uses the Steer up.
      t.send({
        type: "editor-context-changed",
        context: context({
          clips: [...clips, "Here's the error."],
          transcribedClipIds: ["c1", "c2"],
          insertionAnchor: "c2",
          previousItems: { c1: null, c2: "c1" },
        }),
      });
      expect(sent()).toBeUndefined();

      // Back at the Steer's Insertion Point, it stays used up.
      t.send({
        type: "editor-context-changed",
        context: context({
          transcribedClipIds: ["c1", "c2"],
          previousItems: { c1: null, c2: "c1" },
        }),
      });
      expect(getSteerInEffect(t.getState())).toBeUndefined();

      // The Clip deleted: the Steer is back, and asked with.
      t.send({ type: "editor-context-changed", context: context() });
      expect(getSteerInEffect(t.getState())?.text).toBe("Show the error next");
      expect(sent()).toBe("Show the error next");
    });

    it("is not used up by a Clip that was already there, however its transcript comes back", () => {
      const before = context({
        clips: ["So that's a type.", "Later on."],
        transcribedClipIds: ["c1", "c2"],
        previousItems: { c1: null, c2: "c1" },
      });
      const t = opened().send({
        type: "editor-context-changed",
        context: before,
      });
      steer(t, "Add an aside here")
        // Re-transcribed: its transcript goes, then comes back.
        .send({
          type: "editor-context-changed",
          context: { ...before, transcribedClipIds: ["c1"] },
        })
        .send({ type: "editor-context-changed", context: before });
      expect(getSteerInEffect(t.getState())?.text).toBe("Add an aside here");
    });

    it("dismissing the draft, or submitting it empty with no Steer in effect, asks nothing", () => {
      const t = opened()
        .send({ type: "steer-button-clicked" })
        .send({ type: "steer-draft-edited", text: "Never mind" })
        .send({ type: "steer-draft-dismissed" })
        .send({ type: "steer-button-clicked" })
        .send({ type: "steer-submitted" });
      expect(t.getState().steers).toEqual([]);
      expect(t.getEffects()).toEqual([]);
    });
  });
});
