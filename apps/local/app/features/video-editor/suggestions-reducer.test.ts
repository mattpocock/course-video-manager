import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  ALL_SOURCES_INCLUDED,
  createInitialSuggestionsState,
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
  ...overrides,
});

/** The running stream, as `exec` hands it back, so stopping it is visible. */
const runningStream = { stop: () => {} } as never;

const tester = (pickedFiles: string[] = []) => {
  const t = new ReducerTester(
    suggestionsStateReducer,
    createInitialSuggestionsState({
      videoId: "v1",
      included: ALL_SOURCES_INCLUDED,
      notes: "",
      pickedFiles,
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
      .send({ type: "suggestion-chunk-received", requestId: 1, text: "Now" })
      .send({
        type: "suggestion-chunk-received",
        requestId: 1,
        text: "Now try it.",
      })
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
      .send({ type: "suggestion-chunk-received", requestId: 1, text: "Old" })
      .send({
        type: "editor-context-changed",
        context: context({
          clips: ["So that's a type.", "And here's another."],
          transcribedClipIds: ["c1", "c2"],
        }),
      })
      // The superseded stream's late words are ignored.
      .send({
        type: "suggestion-chunk-received",
        requestId: 1,
        text: "Old words",
      });

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
        included: { notes: true, script: true, animatic: true, beats: false },
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
      .send({
        type: "suggestion-chunk-received",
        requestId: 1,
        text: "Now the **important",
      });

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
        included: { notes: true, script: true, animatic: false, beats: true },
      },
      stream(2, { script: "Intro line.", clips: ["So that's a type."] }),
    ]);
  });

  it("closing stops the stream and hands the teleprompter back to the Script", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .send({ type: "suggestion-chunk-received", requestId: 1, text: "Half" })
      .send({ type: "suggestions-tab-closed" })
      .send({
        type: "editor-context-changed",
        context: context({ transcribedClipIds: ["c1", "c2"] }),
      });

    expect(t.getExec().stop).toHaveBeenCalledWith(runningStream);
    expect(t.getEffects()).toHaveLength(2);
    expect(getTeleprompterSuggestion(t.getState())).toBeNull();
  });

  it("edited Notes are stored at once, and asked with after typing pauses", () => {
    const t = tester()
      .send({ type: "suggestions-tab-opened" })
      .send({ type: "script-loaded", videoId: "v1", script: "" })
      .resetExec();
    vi.mocked(t.getExec()).mockReturnValue(runningStream);
    t.send({ type: "notes-edited", notes: "Skip" })
      .send({ type: "notes-edited", notes: "Skip the intro" })
      // The first pause was superseded by the second edit.
      .send({ type: "notes-pause-elapsed", editId: 1 })
      .send({ type: "notes-pause-elapsed", editId: 2 });

    expect(t.getEffects()).toEqual([
      { type: "store-notes", videoId: "v1", notes: "Skip" },
      { type: "wait-for-notes-pause", editId: 1 },
      { type: "store-notes", videoId: "v1", notes: "Skip the intro" },
      { type: "wait-for-notes-pause", editId: 2 },
      stream(2, {
        notes: "Skip the intro",
        animatic: 'Mockup 1: "Hello"',
        clips: ["So that's a type."],
      }),
    ]);
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
});
