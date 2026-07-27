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

describe("editor-spoke", () => {
  it("connects and adopts the editor's video", () => {
    const next = reducer(initialState, {
      type: "editor-spoke",
      videoId: "v1",
      capture: "not-recording",
      tab: "script",
      at: 500,
    });
    expect(next.editorConnected).toBe(true);
    expect(next.videoId).toBe("v1");
    expect(next.lastPongAt).toBe(500);
  });

  it("leaves the crawl still when capture starts", () => {
    const next = reducer(connected(), {
      type: "editor-spoke",
      videoId: "v1",
      capture: "speaking-detected",
      tab: "script",
      at: 2000,
    });
    expect(next.playing).toBe(false);
  });

  it("leaves a hand-started crawl rolling when capture starts", () => {
    const next = reducer(connected({ playing: true }), {
      type: "editor-spoke",
      videoId: "v1",
      capture: "speaking-detected",
      tab: "script",
      at: 2000,
    });
    expect(next.playing).toBe(true);
  });

  it("stops the crawl when capture stops", () => {
    const next = reducer(
      connected({ capture: "speaking-detected", playing: true }),
      {
        type: "editor-spoke",
        videoId: "v1",
        capture: "not-recording",
        tab: "script",
        at: 2000,
      }
    );
    expect(next.playing).toBe(false);
  });

  it("does not undo a manual pause while capture continues", () => {
    // Silence detection changes `capture` constantly mid-take. None of those
    // are a start/stop, so none of them may restart a crawl paused by hand.
    const next = reducer(
      connected({ capture: "speaking-detected", playing: false }),
      {
        type: "editor-spoke",
        videoId: "v1",
        capture: "silence",
        tab: "script",
        at: 2000,
      }
    );
    expect(next.playing).toBe(false);
  });

  it("drops content, pin and crawl when the editor moves to another video", () => {
    const next = reducer(
      connected({
        content: content({ title: "One", script: "hello" }),
        playing: true,
        pinnedSource: { videoId: "v1", source: "beats" },
        lastScriptPushAt: 900,
      }),
      {
        type: "editor-spoke",
        videoId: "v2",
        capture: "not-recording",
        tab: "script",
        at: 2000,
      }
    );
    expect(next.content).toEqual(EMPTY_CONTENT);
    expect(next.playing).toBe(false);
    expect(next.pinnedSource).toBeNull();
    expect(next.lastScriptPushAt).toBe(0);
  });
});

describe("liveness-checked", () => {
  it("disconnects once the editor goes quiet, keeping the text on the glass", () => {
    const state = connected({
      content: content({ script: "hello" }),
      capture: "speaking-detected",
      playing: true,
    });
    const next = reducer(state, {
      type: "liveness-checked",
      at: 1000 + EDITOR_ALIVE_MS + 1,
    });
    expect(next.editorConnected).toBe(false);
    expect(next.capture).toBe("not-recording");
    expect(next.playing).toBe(false);
    expect(next.content.script).toBe("hello");
  });

  it("is a no-op while pongs are arriving", () => {
    const state = connected({ playing: true });
    expect(reducer(state, { type: "liveness-checked", at: 1000 })).toBe(state);
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

  it("preserves identity when nothing changed, so the crawl can't jog", () => {
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

describe("following the editor's tab", () => {
  const both = { hasScript: true, hasBeats: true };

  const spoke = (
    state: teleprompterSession.State,
    tab: "script" | "beats" | "reference"
  ) =>
    reducer(state, {
      type: "editor-spoke",
      videoId: "v1",
      capture: "not-recording",
      tab,
      at: 2000,
    });

  it("shows the beats when the editor is on the Beats tab", () => {
    const next = spoke(connected(), "beats");
    expect(teleprompterSession.resolveSource(next, both)).toBe("beats");
  });

  it("shows the script when the editor is on the Script tab", () => {
    const next = spoke(connected({ editorSource: "beats" }), "script");
    expect(teleprompterSession.resolveSource(next, both)).toBe("script");
  });

  it("holds its ground while the editor is on the Reference tab", () => {
    // Reference has no counterpart on the glass, so the last real tab stands
    // rather than the teleprompter blanking or flipping.
    const next = spoke(connected({ editorSource: "beats" }), "reference");
    expect(next.editorSource).toBe("beats");
    expect(teleprompterSession.resolveSource(next, both)).toBe("beats");
  });

  it("lets the editor changing tab override a source picked by hand", () => {
    const pinned = connected({
      editorSource: "script",
      pinnedSource: { videoId: "v1", source: "beats" },
    });
    expect(spoke(pinned, "beats").pinnedSource).toBeNull();
  });

  it("keeps a hand-picked source while the editor's tab stays put", () => {
    // A pong lands every two seconds; none of them may undo the choice.
    const pinned = connected({
      editorSource: "script",
      pinnedSource: { videoId: "v1", source: "beats" },
    });
    const next = spoke(pinned, "script");
    expect(next.pinnedSource).toEqual({ videoId: "v1", source: "beats" });
    expect(teleprompterSession.resolveSource(next, both)).toBe("beats");
  });
});

describe("resolveSource", () => {
  const both = { hasScript: true, hasBeats: true };

  it("prefers the script when there is one", () => {
    expect(teleprompterSession.resolveSource(connected(), both)).toBe("script");
  });

  it("falls back to beats for a scriptless video", () => {
    expect(
      teleprompterSession.resolveSource(connected(), {
        hasScript: false,
        hasBeats: true,
      })
    ).toBe("beats");
  });

  it("honours a tab chosen by hand", () => {
    const state = connected({
      pinnedSource: { videoId: "v1", source: "beats" },
    });
    expect(teleprompterSession.resolveSource(state, both)).toBe("beats");
  });

  it("ignores a pin left over from another video", () => {
    const state = connected({
      pinnedSource: { videoId: "other", source: "beats" },
    });
    expect(teleprompterSession.resolveSource(state, both)).toBe("script");
  });

  it("pins against the video currently open", () => {
    const next = reducer(connected(), {
      type: "source-picked",
      source: "beats",
    });
    expect(next.pinnedSource).toEqual({ videoId: "v1", source: "beats" });
  });
});
