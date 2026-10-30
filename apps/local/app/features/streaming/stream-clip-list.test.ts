import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrontendId } from "@/features/video-editor/clip-state-reducer";
import {
  cvm,
  editor,
  type Editor,
} from "@/features/video-editor/recorder-takes-test-harness";
import { streamClipList } from "./stream-clip-list";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** What the Streaming tab's Clip list shows, one word per row. */
const listed = (e: Editor) => {
  const { items, sessions, insertionPoint } = e.clips.getState();
  return streamClipList({ items, sessions, insertionPoint }).map((row) => {
    switch (row.kind) {
      case "clip":
        return row.databaseId;
      case "take":
        return row.recording ? "take:recording" : "take:processing";
      case "chapter":
        return `chapter:${row.name}`;
      case "insertion-point":
        return "+";
    }
  });
};

describe("the Streaming tab's Clip list", () => {
  it("shows a Take as an Optimistic Clip at the Insertion Point, then as its saved Clip, as the editor does", async () => {
    const e = editor(["a", "b"]);
    const r = cvm.connect(e);
    e.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    expect(listed(e)).toEqual(["a", "+", "b"]);

    r.startRecording();
    r.startTake();
    expect(listed(e)).toEqual(["a", "take:recording", "+", "b"]);

    await r.saveTake("c1");
    expect(listed(e)).toEqual(["a", "c1", "+", "b"]);
  });

  it("drops a Take the Stream Deck deleted, and one that made no Clip once the recording stops", async () => {
    const e = editor(["a"]);
    const r = cvm.connect(e);
    r.startRecording();
    r.startTake();
    e.send({ type: "delete-latest-inserted-clip" });
    await r.saveTake("c1");
    expect(listed(e)).toEqual(["a", "+"]);

    r.startTake();
    r.stopRecording();
    expect(listed(e)).toEqual(["a", "+"]);
  });
});
