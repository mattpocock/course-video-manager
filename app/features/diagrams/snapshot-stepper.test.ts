import { describe, it, expect } from "vitest";
import type { Snapshot } from "./snapshot-list";
import { createSnapshotStepper } from "./snapshot-stepper";

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

/** Let every pending promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A stand-in for the server and canvas the stepper drives, wired at the same
 * seam the hook uses: a timeline to read, an autosave that PATCHes whatever the
 * canvas currently holds, and a restore that moves both.
 */
function fakeDiagram(opts: {
  snapshots?: Snapshot[];
  headContentHash: string | null;
  /**
   * Hold each restore open between its two halves — the server commit and the
   * canvas catching up — so a second step can be attempted inside that window.
   */
  holdRestore?: boolean;
}) {
  let head = opts.headContentHash;
  let canvas = opts.headContentHash;
  const events: string[] = [];
  const confirmations: boolean[] = [];
  /** Every value the server head took, in order. */
  const headWrites: (string | null)[] = [];
  let release: (() => void) | null = null;

  const setHead = (value: string | null) => {
    head = value;
    headWrites.push(value);
  };

  const stepper = createSnapshotStepper({
    flushPendingSave: async () => {
      events.push("flush");
      setHead(canvas);
    },
    readTimeline: async () => {
      events.push("read");
      return { snapshots: opts.snapshots ?? timeline, headContentHash: head };
    },
    requestRestore: async (target, headIsCaptured) => {
      events.push(`restore:${target.id}`);
      confirmations.push(headIsCaptured);
      // `performRestore` POSTs first, so the head moves server-side before
      // `loadSnapshot` puts the same scene on the canvas.
      setHead(target.contentHash);
      if (opts.holdRestore) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      canvas = target.contentHash;
    },
  });

  return {
    stepper,
    events,
    confirmations,
    headWrites,
    get head() {
      return head;
    },
    async finishRestore() {
      release?.();
      release = null;
      await settle();
    },
  };
}

describe("createSnapshotStepper", () => {
  it("lands the debounced save before reading where the head is", async () => {
    // The head hash is the cursor. Reading it before the last 500ms of edits
    // have been PATCHed makes unsaved work look like the newest snapshot.
    const d = fakeDiagram({ headContentHash: "h3" });
    await d.stepper.step("older");
    expect(d.events).toEqual(["flush", "read", "restore:b"]);
  });

  it("carries the confirmation flag through to the restore", async () => {
    // Unsaved edits sit past the newest snapshot: that head is work existing
    // nowhere else, so the surrounding chrome must get the chance to warn.
    const d = fakeDiagram({ headContentHash: "unsaved" });
    await d.stepper.step("older");
    expect(d.confirmations).toEqual([false]);
  });

  it("does not ask for confirmation when the head sits on a Clip-pinned snapshot", async () => {
    // Stepping lands on whatever the timeline holds, preserved or not. Warning
    // that the head "can't be recovered" when it is the snapshot one row over
    // would mean a dialog on every hop across a run of auto snapshots.
    const pinned = [
      snapshot({ id: "a", contentHash: "h1" }),
      snapshot({ id: "b", contentHash: "h2", preserved: false }),
    ];
    const d = fakeDiagram({ snapshots: pinned, headContentHash: "h2" });
    await d.stepper.step("older");
    expect(d.confirmations).toEqual([true]);
  });

  it("refuses a second step until the first restore has landed", async () => {
    // Holding the chord repeats the keypress. Aiming the next step off a head
    // the in-flight restore has not moved yet just re-targets the same stop.
    const d = fakeDiagram({ headContentHash: "h3", holdRestore: true });
    void d.stepper.step("older");
    await settle();

    expect(await d.stepper.step("older")).toEqual({ kind: "busy" });
    expect(d.events).toEqual(["flush", "read", "restore:b"]);
  });

  it("does not write the pre-restore canvas back over the restored head", async () => {
    // The sharp edge behind the guard: a repeat's `flushPendingSave` PATCHes
    // whatever the canvas still holds, which lands *after* the restore has
    // committed and silently undoes it server-side. The head must move once,
    // forwards — never back to the content it started on.
    const d = fakeDiagram({ headContentHash: "h3", holdRestore: true });
    void d.stepper.step("older");
    await settle();
    await d.stepper.step("older");
    await d.finishRestore();

    expect(d.headWrites).toEqual(["h3", "h2"]);
  });

  it("advances again once the restore has landed", async () => {
    const d = fakeDiagram({ headContentHash: "h3", holdRestore: true });
    void d.stepper.step("older");
    await settle();
    await d.finishRestore();

    void d.stepper.step("older");
    await settle();
    await d.finishRestore();

    expect(d.head).toBe("h1");
  });

  it("breaks ties with the stop the previous step landed on", async () => {
    // The same content can appear twice on the timeline. Without the hint the
    // head's hash matches the earlier copy, and stepping back off the later one
    // reports "no older snapshot".
    const revisited = [
      snapshot({ id: "a", contentHash: "h1" }),
      snapshot({ id: "b", contentHash: "h2" }),
      snapshot({ id: "c", contentHash: "h1" }),
    ];
    const d = fakeDiagram({ snapshots: revisited, headContentHash: "h2" });
    await d.stepper.step("newer");
    expect(await d.stepper.step("older")).toMatchObject({
      snapshot: { id: "b" },
    });
  });

  it("reports the end of the timeline in the direction asked for", async () => {
    const d = fakeDiagram({ headContentHash: "h1" });
    expect(await d.stepper.step("older")).toEqual({
      kind: "at-end",
      step: "older",
    });
  });

  it("reports a timeline it could not read", async () => {
    const stepper = createSnapshotStepper({
      flushPendingSave: async () => {},
      readTimeline: async () => null,
      requestRestore: () => {},
    });
    expect(await stepper.step("older")).toEqual({ kind: "unavailable" });
  });

  it("keeps stepping after a failed read", async () => {
    // A transient failure must not wedge the guard shut for the rest of the
    // session — the next keypress has to get a fresh attempt.
    let attempts = 0;
    const stepper = createSnapshotStepper({
      flushPendingSave: async () => {},
      readTimeline: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("network");
        return { snapshots: timeline, headContentHash: "h3" };
      },
      requestRestore: () => {},
    });

    expect(await stepper.step("older")).toEqual({ kind: "unavailable" });
    expect(await stepper.step("older")).toMatchObject({
      snapshot: { id: "b" },
    });
  });
});
