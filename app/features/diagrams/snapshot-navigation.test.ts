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

const chord = (over: Partial<Parameters<typeof snapshotStepFromKey>[0]>) =>
  snapshotStepFromKey({
    key: "[",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  });

/** Oldest first, matching `/api/diagrams/:id/snapshots/list`. */
const timeline = [
  snapshot({ id: "a", contentHash: "h1" }),
  snapshot({ id: "b", contentHash: "h2" }),
  snapshot({ id: "c", contentHash: "h3" }),
];

/** A ring of one: every direction leads back to the stop you are on. */
const singleStop = [snapshot({ id: "a", contentHash: "h1" })];

describe("snapshotStepFromKey", () => {
  it("steps older on Ctrl-[ and newer on Ctrl-]", () => {
    expect(chord({ key: "[", ctrlKey: true })).toBe("older");
    expect(chord({ key: "]", ctrlKey: true })).toBe("newer");
  });

  it("accepts Cmd as well as Ctrl, like every other playground shortcut", () => {
    expect(chord({ key: "]", metaKey: true })).toBe("newer");
  });

  it("leaves any other bracket chord alone", () => {
    // An unmodified bracket is just typing, and Ctrl-Shift-[ / Ctrl-Alt-[ are
    // different chords — claiming them would shadow whatever tldraw or the
    // browser binds there.
    expect(chord({})).toBe(null);
    expect(chord({ ctrlKey: true, shiftKey: true })).toBe(null);
    expect(chord({ ctrlKey: true, altKey: true })).toBe(null);
  });
});

describe("snapshotAtStep", () => {
  it("steps back one snapshot from the state the head already holds", () => {
    expect(snapshotAtStep(timeline, "h3", "older", null)?.id).toBe("b");
  });

  it("steps forward one snapshot", () => {
    expect(snapshotAtStep(timeline, "h1", "newer", null)?.id).toBe("b");
  });

  it("treats an unsaved head as sitting past the newest snapshot", () => {
    // Edits since the last snapshot are not on the timeline at all, so the
    // first step back lands on the newest snapshot rather than skipping it.
    expect(snapshotAtStep(timeline, "unsaved", "older", null)?.id).toBe("c");
  });

  it("wraps forward off the unsaved place to the oldest snapshot", () => {
    // Past-the-newest is already over the end, so forward from there wraps —
    // to the same place the newest snapshot itself leads to. The unsaved place
    // is where a walk starts, not a stop the ring ever comes back around to.
    expect(snapshotAtStep(timeline, "unsaved", "newer", null)?.id).toBe("a");
  });

  it("wraps around the ends of the timeline", () => {
    // The timeline is a ring: stepping off either end comes back on the other
    // side, rather than stopping dead and telling the author so.
    expect(snapshotAtStep(timeline, "h1", "older", null)?.id).toBe("c");
    expect(snapshotAtStep(timeline, "h3", "newer", null)?.id).toBe("a");
  });

  it("has nowhere to go on an empty timeline", () => {
    expect(snapshotAtStep([], null, "older", null)).toBe(null);
    expect(snapshotAtStep([], null, "newer", null)).toBe(null);
  });

  it("has nowhere to go when the head sits on the timeline's only stop", () => {
    // Wrapping around a one-stop ring lands back where the head already is.
    // That is not a step, so it reports the same nothing an empty timeline
    // does rather than restoring the canvas onto itself.
    expect(snapshotAtStep(singleStop, "h1", "older", null)).toBe(null);
    expect(snapshotAtStep(singleStop, "h1", "newer", null)).toBe(null);
  });

  it("reaches the only stop on the timeline from an unsaved head", () => {
    // Unsaved edits are a place of their own, one past the newest snapshot, so
    // either direction is a real move onto that snapshot.
    expect(snapshotAtStep(singleStop, "unsaved", "older", null)?.id).toBe("a");
    expect(snapshotAtStep(singleStop, "unsaved", "newer", null)?.id).toBe("a");
  });

  it("treats a head with no content hash as unsaved", () => {
    expect(snapshotAtStep(timeline, null, "older", null)?.id).toBe("c");
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
    expect(snapshotAtStep(withDuplicate, "h3", "older", null)?.id).toBe("b2");
    expect(snapshotAtStep(withDuplicate, "h2", "older", null)?.id).toBe("a");
    expect(snapshotAtStep(withDuplicate, "h1", "newer", null)?.id).toBe("b2");
  });

  it("steps over a stop holding the head's own content", () => {
    // The same content can reappear further along the timeline, where
    // `distinctStops` cannot collapse it. Wrapping straight onto that other
    // copy would restore the canvas onto itself: nothing moves and nothing is
    // said, so the chord reads as broken. The next distinct stop is the step.
    const revisited = [
      snapshot({ id: "a", contentHash: "h1" }),
      snapshot({ id: "b", contentHash: "h2" }),
      snapshot({ id: "c", contentHash: "h1" }),
    ];
    expect(snapshotAtStep(revisited, "h1", "older", null)?.id).toBe("b");
  });

  it("uses the last-visited snapshot to break ties between equal hashes", () => {
    // Which copy of "h1" the author stands on decides what lies one step
    // newer; the head's hash alone matches the earlier one, so only the hint
    // can tell the two apart.
    const revisited = [
      snapshot({ id: "a", contentHash: "h1" }),
      snapshot({ id: "b", contentHash: "h2" }),
      snapshot({ id: "c", contentHash: "h1" }),
      snapshot({ id: "d", contentHash: "h3" }),
    ];
    expect(snapshotAtStep(revisited, "h1", "newer", null)?.id).toBe("b");
    expect(snapshotAtStep(revisited, "h1", "newer", "c")?.id).toBe("d");
  });

  it("ignores a hint the head has since moved away from", () => {
    // The confirm dialog can be dismissed, and the canvas is edited freely
    // between steps; a hint only counts while the head still holds its content.
    // Honouring this one would step forward off "c" and wrap to "a".
    expect(snapshotAtStep(timeline, "h1", "newer", "c")?.id).toBe("b");
  });

  it("ignores a hint naming a snapshot that is no longer on the timeline", () => {
    // Non-preserved snapshots vanish when the Clips pinning them are archived,
    // so a run of steps can outlive the stop it last landed on.
    expect(snapshotAtStep(timeline, "h3", "older", "gone")?.id).toBe("b");
  });
});

describe("isTextEntryTarget", () => {
  it("is false for the canvas, and for no target at all", () => {
    expect(isTextEntryTarget({ tagName: "DIV", closest: () => null })).toBe(
      false
    );
    expect(isTextEntryTarget(null)).toBe(false);
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
});
