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
  recentClips: ["So that's a type."],
  transcribedClipIds: ["c1"],
  ...overrides,
});

/** The running stream, as `exec` hands it back, so stopping it is visible. */
const runningStream = { stop: () => {} } as never;

const tester = () => {
  const t = new ReducerTester(
    suggestionsStateReducer,
    createInitialSuggestionsState({
      videoId: "v1",
      included: ALL_SOURCES_INCLUDED,
      notes: "",
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
        recentClips: ["So that's a type."],
      }),
    ]);
    expect(t.getState().status).toBe("done");
    expect(getTeleprompterSuggestion(t.getState())).toBe("Now try it.");
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
          recentClips: ["So that's a type.", "And here's another."],
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
        recentClips: ["So that's a type.", "And here's another."],
      })
    );
    expect(getTeleprompterSuggestion(t.getState())).toBe("");
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
      stream(2, { script: "Intro line.", recentClips: ["So that's a type."] }),
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
        recentClips: ["So that's a type."],
      }),
    ]);
  });
});
