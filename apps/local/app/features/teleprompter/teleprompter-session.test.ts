import { describe, expect, it } from "vitest";
import {
  teleprompterSession,
  EDITOR_ALIVE_MS,
  LIVE_SCRIPT_WINS_MS,
} from "./teleprompter-session";

const { reducer, initialState, EMPTY_CONTENT } = teleprompterSession;

const connected = (
  overrides: Partial<teleprompterSession.State> = {}
): teleprompterSession.State => ({
  ...initialState,
  editorConnected: true,
  videoId: "v1",
  lastPongAt: 1000,
  ...overrides,
});

const content = (
  overrides: Partial<teleprompterSession.Content> = {}
): teleprompterSession.Content => ({ ...EMPTY_CONTENT, ...overrides });

describe("editor-state", () => {
  it("connects and adopts the editor's video", () => {
    const next = reducer(initialState, {
      type: "editor-state",
      videoId: "v1",
      capture: "not-recording",
      at: 500,
    });
    expect(next.editorConnected).toBe(true);
    expect(next.videoId).toBe("v1");
    expect(next.lastPongAt).toBe(500);
  });

  it("drops content when the editor moves to another video", () => {
    const next = reducer(
      connected({
        content: content({ title: "One", script: "hello" }),
        lastScriptPushAt: 900,
      }),
      {
        type: "editor-state",
        videoId: "v2",
        capture: "not-recording",
        at: 2000,
      }
    );
    expect(next.content).toEqual(EMPTY_CONTENT);
    expect(next.lastScriptPushAt).toBe(0);
  });
});

describe("suggestion", () => {
  it("takes the glass from the Script while pushed, and hands it back when withdrawn", () => {
    const state = connected({ content: content({ script: "the script" }) });
    const push = (suggestion: string | null) => ({
      type: "editor-state" as const,
      videoId: "v1",
      capture: "not-recording" as const,
      suggestion,
      suggestionId: 4,
      suggestionPreviousClips: ["before"],
      at: 2000,
    });

    const showing = reducer(state, push("say this next"));
    expect(showing.suggestion).toEqual({
      id: 4,
      text: "say this next",
      previousClips: ["before"],
    });

    const withdrawn = reducer(showing, push(null));
    expect(withdrawn.suggestion).toBeNull();
    expect(withdrawn.content.script).toBe("the script");
  });
});

describe("editor-alive", () => {
  it("keeps the editor connected without touching what's on the glass", () => {
    const state = connected({
      content: content({ script: "hello" }),
      capture: "speaking-detected",
    });
    const next = reducer(state, { type: "editor-alive", at: 3000 });
    expect(next.lastPongAt).toBe(3000);
    expect(next.editorConnected).toBe(true);
    expect(next.videoId).toBe("v1");
    expect(next.capture).toBe("speaking-detected");
    expect(next.content).toBe(state.content);
  });

  it("reconnects an editor that went quiet and came back", () => {
    const next = reducer(connected({ editorConnected: false }), {
      type: "editor-alive",
      at: 9000,
    });
    expect(next.editorConnected).toBe(true);
  });
});

describe("liveness-checked", () => {
  it("disconnects once the editor goes quiet, keeping the text on the glass", () => {
    const state = connected({
      content: content({ script: "hello" }),
      capture: "speaking-detected",
    });
    const next = reducer(state, {
      type: "liveness-checked",
      at: 1000 + EDITOR_ALIVE_MS + 1,
    });
    expect(next.editorConnected).toBe(false);
    expect(next.capture).toBe("not-recording");
    expect(next.content.script).toBe("hello");
  });

  it("is a no-op while pongs are arriving", () => {
    const state = connected();
    expect(reducer(state, { type: "liveness-checked", at: 1000 })).toBe(state);
  });

  it("clears the session marks, which nobody is refreshing any more", () => {
    // A frozen row of dots reads as a live claim about clips. Worse than none.
    const state = connected({ marks: ["landed", "pending"] });
    const next = reducer(state, {
      type: "liveness-checked",
      at: 1000 + EDITOR_ALIVE_MS + 1,
    });
    expect(next.marks).toEqual([]);
  });
});

describe("session marks", () => {
  it("adopts what the editor pushed", () => {
    const next = reducer(connected(), {
      type: "editor-state",
      videoId: "v1",
      capture: "long-enough-speaking-for-clip-detected",
      marks: ["landed", "pending"],
      at: 2000,
    });
    expect(next.marks).toEqual(["landed", "pending"]);
  });

  it("drops another video's marks when the editor moves on", () => {
    const next = reducer(connected({ marks: ["landed"] }), {
      type: "editor-state",
      videoId: "v2",
      capture: "not-recording",
      marks: ["pending"],
      at: 2000,
    });
    expect(next.marks).toEqual([]);
  });

  it("reads an editor that says nothing about marks as no session", () => {
    const next = reducer(connected({ marks: ["landed"] }), {
      type: "editor-state",
      videoId: "v1",
      capture: "not-recording",
      at: 2000,
    });
    expect(next.marks).toEqual([]);
  });
});

describe("latest transcript", () => {
  it("adopts what the editor pushed", () => {
    const next = reducer(connected(), {
      type: "editor-state",
      videoId: "v1",
      capture: "silence",
      latestTranscript: "So what is a type?",
      at: 2000,
    });
    expect(next.latestTranscript).toBe("So what is a type?");
  });

  it("drops another video's transcript when the editor moves on", () => {
    const next = reducer(connected({ latestTranscript: "Old" }), {
      type: "editor-state",
      videoId: "v2",
      capture: "not-recording",
      latestTranscript: "Old",
      at: 2000,
    });
    expect(next.latestTranscript).toBe(null);
  });

  it("clears once the editor goes quiet", () => {
    const next = reducer(connected({ latestTranscript: "Stale" }), {
      type: "liveness-checked",
      at: 1000 + EDITOR_ALIVE_MS + 1,
    });
    expect(next.latestTranscript).toBe(null);
  });
});

describe("video length", () => {
  it("follows the editor as clips land, and across a move to another video", () => {
    const push = (videoId: string, videoLengthSeconds: number) => ({
      type: "editor-state" as const,
      videoId,
      capture: "silence" as const,
      videoLengthSeconds,
      at: 2000,
    });
    const afterFirstClip = reducer(connected(), push("v1", 42));
    const afterSecondClip = reducer(afterFirstClip, push("v1", 97));
    const onNextVideo = reducer(afterSecondClip, push("v2", 610));
    expect(afterSecondClip.videoLengthSeconds).toBe(97);
    expect(onNextVideo.videoLengthSeconds).toBe(610);
  });

  it("clears once the editor goes quiet", () => {
    const next = reducer(connected({ videoLengthSeconds: 97 }), {
      type: "liveness-checked",
      at: 1000 + EDITOR_ALIVE_MS + 1,
    });
    expect(next.videoLengthSeconds).toBe(null);
  });
});

describe("script-pushed", () => {
  it("puts the editor's live text straight on the glass", () => {
    const next = reducer(connected(), {
      type: "script-pushed",
      videoId: "v1",
      script: "live text",
      at: 2000,
    });
    expect(next.content.script).toBe("live text");
    expect(next.lastScriptPushAt).toBe(2000);
  });

  it("ignores a push for a different video", () => {
    const state = connected();
    expect(
      reducer(state, {
        type: "script-pushed",
        videoId: "other",
        script: "nope",
        at: 2000,
      })
    ).toBe(state);
  });
});

describe("content-fetched", () => {
  it("takes the server's script when no live edit is in flight", () => {
    const next = reducer(connected(), {
      type: "content-fetched",
      videoId: "v1",
      content: content({ title: "One", script: "from server" }),
      at: 10_000,
    });
    expect(next.content.script).toBe("from server");
    expect(next.content.title).toBe("One");
  });

  it("does not let a stale poll clobber a live edit", () => {
    const state = connected({
      content: content({ script: "just typed" }),
      lastScriptPushAt: 10_000,
    });
    const next = reducer(state, {
      type: "content-fetched",
      videoId: "v1",
      content: content({ title: "One", script: "old text" }),
      at: 10_000 + LIVE_SCRIPT_WINS_MS - 1,
    });
    expect(next.content.script).toBe("just typed");
    // Everything else in the poll still lands.
    expect(next.content.title).toBe("One");
  });

  it("resumes taking the server's script once the live window lapses", () => {
    const state = connected({
      content: content({ script: "just typed" }),
      lastScriptPushAt: 10_000,
    });
    const next = reducer(state, {
      type: "content-fetched",
      videoId: "v1",
      content: content({ script: "caught up" }),
      at: 10_000 + LIVE_SCRIPT_WINS_MS,
    });
    expect(next.content.script).toBe("caught up");
  });

  it("preserves identity when nothing changed, so the script can't jog", () => {
    const state = connected({ content: content({ script: "same" }) });
    expect(
      reducer(state, {
        type: "content-fetched",
        videoId: "v1",
        content: content({ script: "same" }),
        at: 10_000,
      })
    ).toBe(state);
  });

  it("ignores a poll that resolved for the previous video", () => {
    const state = connected();
    expect(
      reducer(state, {
        type: "content-fetched",
        videoId: "stale",
        content: content({ script: "wrong video" }),
        at: 10_000,
      })
    ).toBe(state);
  });
});
