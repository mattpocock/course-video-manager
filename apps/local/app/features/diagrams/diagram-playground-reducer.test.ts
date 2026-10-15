import { describe, expect, it } from "vitest";
import {
  isCanvasEditable,
  mustKeepCanvasBeforeLeaving,
  STATUS_ERROR_MS,
  type StoredHead,
} from "./diagram-playground-reducer";
import {
  loaded,
  openPage,
  scene,
  shown,
  storedHead,
  T0,
  T1,
  T2,
} from "./diagram-playground-reducer-test-helpers";

describe("diagramPlaygroundReducer", () => {
  it("opening a diagram shows its head without ever saving it", () => {
    const tester = openPage().send(loaded("d1", scene("d1")));

    expect(isCanvasEditable(tester.getState())).toBe(true);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      shown("d1", scene("d1")),
    ]);
  });

  it("a diagram whose head failed to load can't be edited until a retry loads it", () => {
    const tester = openPage().send({
      type: "head-load-failed",
      diagramId: "d1",
    });

    expect(isCanvasEditable(tester.getState())).toBe(false);
    expect(tester.getState().head).toMatchObject({
      diagramId: "d1",
      status: "failed",
    });

    tester.send({ type: "retry-load-clicked" }).send(loaded("d1", scene("d1")));

    expect(isCanvasEditable(tester.getState())).toBe(true);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      { type: "clear-canvas" },
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      shown("d1", scene("d1")),
    ]);
  });

  it("switching diagrams saves the one being left, but reloading the same one after a search restore does not", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({ type: "diagram-opened", diagramId: "d2" })
      .send(loaded("d2", null))
      .send({ type: "head-moved-elsewhere", diagramId: "d2" });

    expect(isCanvasEditable(tester.getState())).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d2", saveOpenHeadFirst: true },
      shown("d2", null),
      { type: "load-head", diagramId: "d2", saveOpenHeadFirst: false },
    ]);
  });

  it("a head that arrives after the page has moved to another diagram is ignored", () => {
    const tester = openPage()
      .send({ type: "diagram-opened", diagramId: "d2" })
      .resetExec()
      .send(loaded("d1", scene("d1")))
      .send({ type: "head-load-failed", diagramId: "d1" });

    expect(tester.getState().head).toMatchObject({
      diagramId: "d2",
      status: "loading",
    });
    expect(tester.getEffects()).toEqual([]);
  });

  it("preserving ignores repeat clicks until it finishes, and a failure can be retried", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({ type: "preserve-clicked" })
      .send({ type: "preserve-clicked" })
      .send({ type: "preserve-failed", reason: "empty-diagram" })
      .send({ type: "preserve-clicked" })
      .send({ type: "snapshot-preserved", created: true });

    expect(tester.getState().preserving).toBe(false);
    // The retry worked, so the empty-diagram error is gone from the status line.
    expect(tester.getState().error).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "preserve-snapshot", diagramId: "d1" },
      { type: "time-out-error", id: 1, ms: STATUS_ERROR_MS },
      { type: "preserve-snapshot", diagramId: "d1" },
    ]);
  });

  it("creating a diagram ignores repeat clicks, then opens the new diagram", () => {
    const tester = openPage()
      .resetExec()
      .send({ type: "create-clicked" })
      .send({ type: "create-clicked" })
      .send({ type: "diagram-created", diagramId: "d9" });

    expect(tester.getState().creating).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "create-diagram" },
      { type: "go-to-diagram", diagramId: "d9" },
    ]);
  });

  it("snapshots the open diagram for a clip, and refuses a clip aimed at another diagram", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({
        type: "clip-snapshot-requested",
        clipId: "c1",
        diagramId: "d2",
        diagramName: "Other",
      })
      .send({
        type: "clip-snapshot-requested",
        clipId: "c2",
        diagramId: "d1",
        diagramName: "Open",
      })
      .send({
        type: "clip-snapshot-taken",
        clipId: "c2",
        diagramName: "Open",
        snapshotId: "s5",
      });

    expect(tester.getEffects()).toEqual([
      {
        type: "report-clip-snapshot",
        clipId: "c1",
        ok: false,
        snapshotId: null,
        diagramName: "Other",
      },
      {
        type: "take-clip-snapshot",
        clipId: "c2",
        diagramId: "d1",
        diagramName: "Open",
      },
      {
        type: "report-clip-snapshot",
        clipId: "c2",
        ok: true,
        snapshotId: "s5",
        diagramName: "Open",
      },
    ]);
  });

  it("hides the sidebar when a recording starts and shows it when it stops", () => {
    const tester = openPage().resetExec().send({
      type: "recording-status-reported",
      recording: true,
      format: "landscape",
      fullScreen: true,
    });

    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: true },
      { type: "centre-camera-after-layout", format: "landscape" },
    ]);

    tester
      .send({ type: "focus-mode-changed", isFocusMode: true })
      // The editor repeats its status on every heartbeat.
      .send({
        type: "recording-status-reported",
        recording: true,
        format: "landscape",
        fullScreen: true,
      })
      .send({
        type: "recording-status-reported",
        recording: false,
        format: "landscape",
        fullScreen: true,
      })
      .send({
        type: "recording-status-reported",
        recording: false,
        format: "landscape",
        fullScreen: true,
      });

    // Centred once, as the take starts — never again while it runs, so the
    // author can pan.
    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: true },
      { type: "centre-camera-after-layout", format: "landscape" },
      { type: "set-focus-mode", isFocusMode: false },
    ]);
  });

  it("a sidebar toggled by hand during a recording stays as it was put", () => {
    const tester = openPage()
      .resetExec()
      .send({
        type: "recording-status-reported",
        recording: true,
        format: "landscape",
        fullScreen: true,
      })
      .send({ type: "focus-mode-changed", isFocusMode: true })
      .send({ type: "focus-mode-changed", isFocusMode: false })
      .send({
        type: "recording-status-reported",
        recording: true,
        format: "landscape",
        fullScreen: true,
      });

    expect(tester.getState().isFocusMode).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: true },
      { type: "centre-camera-after-layout", format: "landscape" },
    ]);
  });
});

describe("keeping the Active Diagram in step with its stored head", () => {
  const reported = (
    stored: StoredHead,
    canvasHasUnsavedEdits: boolean,
    diagramId = "d1"
  ) => ({
    type: "stored-head-reported" as const,
    diagramId,
    stored,
    canvasHasUnsavedEdits,
  });

  /** `d1` open on a clean canvas, its head last written at T0. */
  const openD1 = () =>
    openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec();

  it("a head saved elsewhere loads in place, camera kept, when the canvas has nothing unsaved", () => {
    const theirs = storedHead("theirs", T1);
    const tester = openD1().send(reported(theirs, false));

    expect(isCanvasEditable(tester.getState())).toBe(false);

    tester.send(loaded("d1", scene("theirs"), theirs));

    expect(isCanvasEditable(tester.getState())).toBe(true);
    expect(tester.getState().head?.seen).toEqual(theirs);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      shown("d1", scene("theirs"), { stored: theirs, centreCamera: false }),
    ]);
  });

  it("with unsaved edits, a head changed elsewhere asks first and overwrites neither side", () => {
    const tester = openD1()
      .send(reported(storedHead("theirs", T1), true))
      // The refetch keeps coming while the prompt is up.
      .send(reported(storedHead("theirs", T1), true));

    expect(tester.getState().head?.changedElsewhere).toBe(true);
    // The author can keep drawing; the server refuses to save over theirs.
    expect(isCanvasEditable(tester.getState())).toBe(true);
    expect(tester.getEffects()).toEqual([]);

    tester
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" });

    expect(tester.getState().head?.changedElsewhere).toBe(true);
    expect(tester.getEffects()).toEqual([]);
  });

  it("reloading from the prompt drops the unsaved edits for the changed head", () => {
    const theirs = storedHead("theirs", T1);
    const tester = openD1()
      .send(reported(theirs, true))
      .send({ type: "load-changed-head-clicked" })
      .send(loaded("d1", scene("theirs"), theirs));

    expect(tester.getState().head?.changedElsewhere).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      shown("d1", scene("theirs"), { stored: theirs, centreCamera: false }),
    ]);
  });

  it("keeping my edits from the prompt saves them over the changed head", () => {
    const mine = storedHead("mine", T2);
    const tester = openD1()
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" })
      .send({ type: "keep-my-edits-clicked" })
      .send({ type: "keep-my-edits-clicked" })
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-saved", diagramId: "d1", stored: mine });

    expect(tester.getState().head).toMatchObject({
      changedElsewhere: false,
      saving: false,
      seen: mine,
    });
    expect(tester.getState().error).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "overwrite-stored-head", diagramId: "d1" },
    ]);
  });

  it("a save refused after keeping my edits says so in the status line, and the prompt returns", () => {
    const tester = openD1()
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" });

    // A first refusal is the prompt's to explain, not the status line's.
    expect(tester.getState().error).toBeNull();

    tester
      .send({ type: "keep-my-edits-clicked" })
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({
        type: "head-saved",
        diagramId: "d1",
        stored: storedHead("mine", T1),
      })
      // The head changes elsewhere again before the next autosave lands.
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" });

    expect(tester.getState().error?.message).toBe(
      "Your edits weren't saved: this diagram changed elsewhere again."
    );
    expect(tester.getState().head?.changedElsewhere).toBe(true);
    expect(tester.getEffects()).toEqual([
      { type: "overwrite-stored-head", diagramId: "d1" },
      { type: "time-out-error", id: 1, ms: STATUS_ERROR_MS },
    ]);
  });

  it("a failed autosave shows in the status line until an autosave lands", () => {
    const tester = openD1()
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-failed", diagramId: "d1" });

    expect(tester.getState().error?.message).toBe(
      "Couldn't save your edits. The next change retries."
    );

    tester.send({ type: "head-save-started", diagramId: "d1" }).send({
      type: "head-saved",
      diagramId: "d1",
      stored: storedHead("mine", T1),
    });

    expect(tester.getState().error).toBeNull();
  });

  it("the tab's own autosaves never read as a change elsewhere", () => {
    const mine = storedHead("mine", T1);
    const tester = openD1()
      .send({ type: "head-save-started", diagramId: "d1" })
      // The refetch sees our write land before the save's reply does.
      .send(reported(mine, true))
      .send({ type: "head-saved", diagramId: "d1", stored: mine })
      // A refetch that left before the save landed, arriving after it.
      .send(reported(storedHead("head-d1", T0), false))
      .send(reported(mine, false));

    expect(tester.getState().head).toMatchObject({
      status: "ready",
      changedElsewhere: false,
      seen: mine,
    });
    expect(tester.getEffects()).toEqual([]);
  });

  it("a report for a diagram the page has left, or one still loading, is ignored", () => {
    const tester = openPage()
      .resetExec()
      .send(reported(storedHead("theirs", T1), false))
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send(reported(storedHead("theirs", T1), false, "d2"));

    expect(tester.getState().head?.status).toBe("ready");
    expect(tester.getEffects()).toEqual([]);
  });
});

describe("leaving a diagram whose last edits aren't stored yet", () => {
  /** `d1` open, its last autosave refused: the "changed elsewhere" prompt is up. */
  const refusedD1 = () =>
    openPage()
      .send(loaded("d1", scene("d1")))
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" })
      .resetExec();

  const toD2 = { to: "/diagram-playground/d2", replace: false };
  const leave = (destination = toD2, canvasHasUnsavedEdits = true) => ({
    type: "leave-requested" as const,
    destination,
    canvasHasUnsavedEdits,
  });

  it("only a canvas holding edits the server refused has to be kept before leaving", () => {
    const tester = openPage();
    expect(mustKeepCanvasBeforeLeaving(tester.getState())).toBe(false);

    tester.send(loaded("d1", scene("d1")));
    expect(mustKeepCanvasBeforeLeaving(tester.getState())).toBe(false);

    expect(mustKeepCanvasBeforeLeaving(refusedD1().getState())).toBe(true);
  });

  it("switching away while the prompt is up keeps the canvas as a preserved snapshot first, then goes", () => {
    const tester = refusedD1()
      .send(leave())
      // The author clicks again while the canvas is being kept.
      .send(leave({ to: "/diagram-playground", replace: false }));

    expect(tester.getState().leaving).toEqual(toD2);
    expect(tester.getEffects()).toEqual([
      { type: "keep-canvas-as-snapshot", diagramId: "d1" },
    ]);

    tester.resetExec().send({ type: "canvas-kept", diagramId: "d1" });

    // Kept: the navigation now goes through without being held again.
    expect(tester.getState().leaving).toBeNull();
    expect(mustKeepCanvasBeforeLeaving(tester.getState())).toBe(false);

    tester.send({ type: "diagram-opened", diagramId: "d2" });

    expect(tester.getEffects()).toEqual([
      { type: "continue-leaving", destination: toD2 },
      { type: "load-head", diagramId: "d2", saveOpenHeadFirst: true },
    ]);
  });

  it("a save refused after the canvas was kept has to be kept again", () => {
    const tester = refusedD1()
      .send(leave())
      .send({ type: "canvas-kept", diagramId: "d1" })
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" });

    expect(mustKeepCanvasBeforeLeaving(tester.getState())).toBe(true);
  });

  it("if the canvas can't be kept, the author stays on the diagram and the status line says why", () => {
    const tester = refusedD1().send(leave()).resetExec().send({
      type: "keep-canvas-failed",
      diagramId: "d1",
      reason: "request-failed",
    });

    expect(tester.getState().leaving).toBeNull();
    expect(tester.getState().head).toMatchObject({
      diagramId: "d1",
      changedElsewhere: true,
    });
    expect(mustKeepCanvasBeforeLeaving(tester.getState())).toBe(true);
    expect(tester.getState().error?.message).toBe(
      "Couldn't keep your edits as a snapshot, so this diagram stays open. Reload or keep your edits first."
    );
    expect(tester.getEffects()).toEqual([
      { type: "time-out-error", id: 1, ms: STATUS_ERROR_MS },
    ]);
  });

  it("an empty canvas has nothing to keep, so the author leaves", () => {
    const tester = refusedD1().send(leave()).resetExec().send({
      type: "keep-canvas-failed",
      diagramId: "d1",
      reason: "empty-canvas",
    });

    expect(tester.getState().error).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "continue-leaving", destination: toD2 },
    ]);
  });

  it("a leave asked for once the prompt has gone needs nothing kept", () => {
    const tester = refusedD1()
      .send({ type: "keep-my-edits-clicked" })
      .send({
        type: "head-saved",
        diagramId: "d1",
        stored: storedHead("mine", T1),
      })
      .resetExec()
      .send(leave(toD2, false));

    expect(tester.getEffects()).toEqual([
      { type: "continue-leaving", destination: toD2 },
    ]);
  });

  it("leaving within the autosave debounce saves the last edit first, and goes only once it has landed", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send(leave());

    expect(tester.getState().leaving).toEqual(toD2);
    expect(tester.getEffects()).toEqual([
      { type: "save-before-leaving", diagramId: "d1" },
    ]);

    // The flush was refused: the head changed elsewhere in the meantime, so
    // the canvas is kept as a snapshot before the navigation goes on.
    tester
      .resetExec()
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" })
      .send({
        type: "saved-before-leaving",
        diagramId: "d1",
        outcome: "refused",
      });
    expect(tester.getEffects()).toEqual([
      { type: "keep-canvas-as-snapshot", diagramId: "d1" },
    ]);

    // A save that lands goes straight on; one that fails stays and says so.
    const saved = openPage()
      .send(loaded("d1", scene("d1")))
      .send(leave())
      .resetExec()
      .send({
        type: "saved-before-leaving",
        diagramId: "d1",
        outcome: "saved",
      });
    expect(saved.getState().leaving).toBeNull();
    expect(saved.getEffects()).toEqual([
      { type: "continue-leaving", destination: toD2 },
    ]);

    const failed = openPage()
      .send(loaded("d1", scene("d1")))
      .send(leave())
      .resetExec()
      .send({
        type: "saved-before-leaving",
        diagramId: "d1",
        outcome: "failed",
      });
    expect(failed.getState().leaving).toBeNull();
    expect(failed.getState().error?.message).toBe(
      "Couldn't save your last edit, so this diagram stays open. Try again."
    );
    expect(failed.getEffects()).toEqual([
      { type: "time-out-error", id: 1, ms: STATUS_ERROR_MS },
    ]);
  });
});
