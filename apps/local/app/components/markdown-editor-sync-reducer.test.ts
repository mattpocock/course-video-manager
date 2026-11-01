import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialMarkdownEditorSyncState,
  markdownEditorSyncReducer,
} from "./markdown-editor-sync-reducer";

const tester = () =>
  new ReducerTester(
    markdownEditorSyncReducer,
    createInitialMarkdownEditorSyncState()
  );

describe("markdownEditorSyncReducer", () => {
  it("a lagging echo of what the user typed never overwrites newer keystrokes", () => {
    // The user types fast: the host's value prop trails the editor by a few
    // keystrokes, round-tripping through a save.
    const t = tester()
      .send({ type: "editor-content-changed", value: "ab" })
      .send({ type: "editor-content-changed", value: "abc" })
      .send({ type: "editor-content-changed", value: "abcd" })
      .send({ type: "value-prop-received", value: "ab", modelValue: "abcd" })
      .send({ type: "editor-content-changed", value: "abcde" })
      .send({ type: "value-prop-received", value: "abc", modelValue: "abcde" })
      .send({
        type: "value-prop-received",
        value: "abcde",
        modelValue: "abcde",
      });

    expect(t.getEffects()).toEqual([]);
  });

  it("an external value, such as the writer's Apply, replaces the text", () => {
    const t = tester()
      .send({ type: "editor-content-changed", value: "draft" })
      .send({
        type: "value-prop-received",
        value: "Applied article",
        modelValue: "draft",
      });

    expect(t.getEffects()).toEqual([
      { type: "replace-text", text: "Applied article" },
    ]);
  });

  it("once the host has caught up, an old typed value coming back is external", () => {
    const t = tester()
      .send({ type: "editor-content-changed", value: "ab" })
      .send({ type: "editor-content-changed", value: "abc" })
      .send({ type: "value-prop-received", value: "abc", modelValue: "abc" })
      // e.g. an undo-to-saved-version from the writer
      .send({ type: "value-prop-received", value: "ab", modelValue: "abc" });

    expect(t.getEffects()).toEqual([{ type: "replace-text", text: "ab" }]);
  });
});
