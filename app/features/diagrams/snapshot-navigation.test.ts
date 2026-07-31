import { describe, it, expect } from "vitest";
import type { Snapshot } from "./snapshot-list";
import {
  isTextEntryTarget,
  snapshotAtStep,
  snapshotStepFromKey,
} from "./snapshot-navigation";

const snapshot = (over: Partial<Snapshot>): Snapshot => ({
  id: "s1",
  diagramId: "d1",
  scene: null,
  contentHash: "aaa",
  preserved: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** Oldest first, matching `/api/diagrams/:id/snapshots/list`. */
const timeline = [
  snapshot({ id: "a", contentHash: "h1" }),
  snapshot({ id: "b", contentHash: "h2" }),
  snapshot({ id: "c", contentHash: "h3" }),
];

describe("snapshotStepFromKey", () => {
  it("reads Ctrl-[ as a step towards older snapshots", () => {
    expect(
      snapshotStepFromKey({
        key: "[",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBe("older");
  });

  it("reads Ctrl-] as a step towards newer snapshots", () => {
    expect(
      snapshotStepFromKey({
        key: "]",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBe("newer");
  });

  it("accepts Cmd as well as Ctrl, like every other playground shortcut", () => {
    expect(
      snapshotStepFromKey({
        key: "]",
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      })
    ).toBe("newer");
  });

  it("ignores an unmodified bracket, which is just typing", () => {
    expect(
      snapshotStepFromKey({
        key: "[",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBe(null);
  });

  it("ignores brackets with extra modifiers", () => {
    // Ctrl-Shift-[ is a different chord; claiming it would shadow whatever
    // tldraw or the browser binds there.
    expect(
      snapshotStepFromKey({
        key: "[",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      })
    ).toBe(null);
    expect(
      snapshotStepFromKey({
        key: "[",
        ctrlKey: true,
        metaKey: false,
        altKey: true,
        shiftKey: false,
      })
    ).toBe(null);
  });

  it("ignores other keys", () => {
    expect(
      snapshotStepFromKey({
        key: "k",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBe(null);
  });
});

describe("snapshotAtStep", () => {
  it("steps back one snapshot from the state the head already holds", () => {
    expect(snapshotAtStep(timeline, "h3", "older")?.id).toBe("b");
  });

  it("steps forward one snapshot", () => {
    expect(snapshotAtStep(timeline, "h1", "newer")?.id).toBe("b");
  });

  it("treats an unsaved head as sitting past the newest snapshot", () => {
    // Edits since the last snapshot are not on the timeline at all, so the
    // first step back lands on the newest snapshot rather than skipping it.
    expect(snapshotAtStep(timeline, "unsaved", "older")?.id).toBe("c");
    expect(snapshotAtStep(timeline, "unsaved", "newer")).toBe(null);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(snapshotAtStep(timeline, "h1", "older")).toBe(null);
    expect(snapshotAtStep(timeline, "h3", "newer")).toBe(null);
  });

  it("has nowhere to go on an empty timeline", () => {
    expect(snapshotAtStep([], null, "older")).toBe(null);
    expect(snapshotAtStep([], null, "newer")).toBe(null);
  });

  it("treats a head with no content hash as unsaved", () => {
    expect(snapshotAtStep(timeline, null, "older")?.id).toBe("c");
  });

  it("skips over a neighbour holding identical content", () => {
    // Restoring makes the head byte-identical to its snapshot, so position is
    // read back off the content hash. Adjacent snapshots that share a hash
    // (a Restore, then a Preserve of the restored state) would otherwise pin
    // the cursor: every step back would restore the same content, leave the
    // head hash unchanged, and land on the same place again — stuck.
    const withDuplicate = [
      snapshot({ id: "a", contentHash: "h1" }),
      snapshot({ id: "b", contentHash: "h2" }),
      snapshot({ id: "b2", contentHash: "h2" }),
      snapshot({ id: "c", contentHash: "h3" }),
    ];
    expect(snapshotAtStep(withDuplicate, "h3", "older")?.id).toBe("b2");
    expect(snapshotAtStep(withDuplicate, "h2", "older")?.id).toBe("a");
    expect(snapshotAtStep(withDuplicate, "h1", "newer")?.id).toBe("b2");
  });

  it("uses the last-visited snapshot to break ties between equal hashes", () => {
    // The same content can reappear later in the timeline. Without the hint,
    // the head's hash matches the earlier one and stepping back reports "no
    // older snapshot" while the author is looking at the later copy.
    const revisited = [
      snapshot({ id: "a", contentHash: "h1" }),
      snapshot({ id: "b", contentHash: "h2" }),
      snapshot({ id: "c", contentHash: "h1" }),
    ];
    expect(snapshotAtStep(revisited, "h1", "older")).toBe(null);
    expect(snapshotAtStep(revisited, "h1", "older", "c")?.id).toBe("b");
  });

  it("ignores a hint the head has since moved away from", () => {
    // The confirm dialog can be dismissed, and the canvas is edited freely
    // between steps; a hint only counts while the head still holds its content.
    expect(snapshotAtStep(timeline, "h1", "older", "c")).toBe(null);
  });
});

describe("isTextEntryTarget", () => {
  it("is false for the canvas itself", () => {
    expect(isTextEntryTarget({ tagName: "DIV", closest: () => null })).toBe(
      false
    );
  });

  it("is true inside a text field", () => {
    expect(isTextEntryTarget({ tagName: "INPUT", closest: () => null })).toBe(
      true
    );
    expect(
      isTextEntryTarget({ tagName: "TEXTAREA", closest: () => null })
    ).toBe(true);
  });

  it("is true while editing shape text", () => {
    // tldraw edits label text in a contenteditable, where `[` is a character.
    expect(
      isTextEntryTarget({
        tagName: "DIV",
        isContentEditable: true,
        closest: () => null,
      })
    ).toBe(true);
  });

  it("is true anywhere inside a dialog", () => {
    // The command palette and the restore-confirmation dialog both own their
    // keyboard while open.
    expect(isTextEntryTarget({ tagName: "DIV", closest: () => ({}) })).toBe(
      true
    );
  });

  it("is false when there is no target at all", () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
