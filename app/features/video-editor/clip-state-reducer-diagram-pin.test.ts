import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";

const createInitialState = (
  overrides: Partial<clipStateReducer.State> = {}
): clipStateReducer.State => ({
  clipIdsBeingTranscribed: new Set(),
  items: [],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
  ...overrides,
});

const createClipOnDatabase = (
  overrides: Partial<ClipOnDatabase> = {}
): ClipOnDatabase => ({
  type: "on-database",
  frontendId: crypto.randomUUID() as FrontendId,
  databaseId: crypto.randomUUID() as DatabaseId,
  videoFilename: "test.mp4",
  sourceStartTime: 0,
  sourceEndTime: 10,
  text: "Hello world",
  transcribedAt: new Date(),
  scene: "main",
  profile: "main-camera",
  insertionOrder: 1,
  pauseType: "none",
  diagramSnapshotId: null,
  diagramName: null,
  webLinks: [],
  ...overrides,
});

describe("clipStateReducer - update-clip-diagram-pin", () => {
  it("sets diagramSnapshotId and diagramName on a database clip", () => {
    const clip = createClipOnDatabase();
    const tester = new ReducerTester(
      clipStateReducer,
      createInitialState({ items: [clip] })
    );

    const state = tester
      .send({
        type: "update-clip-diagram-pin",
        clipId: clip.frontendId,
        diagramSnapshotId: "snap-123",
        diagramName: "My Diagram",
      })
      .getState();

    const updated = state.items[0] as ClipOnDatabase;
    expect(updated.diagramSnapshotId).toBe("snap-123");
    expect(updated.diagramName).toBe("My Diagram");
  });

  it("clears both fields when unpinning (setting null)", () => {
    const clip = createClipOnDatabase({
      diagramSnapshotId: "snap-123",
      diagramName: "My Diagram",
    });
    const tester = new ReducerTester(
      clipStateReducer,
      createInitialState({ items: [clip] })
    );

    const state = tester
      .send({
        type: "update-clip-diagram-pin",
        clipId: clip.frontendId,
        diagramSnapshotId: null,
        diagramName: null,
      })
      .getState();

    const updated = state.items[0] as ClipOnDatabase;
    expect(updated.diagramSnapshotId).toBeNull();
    expect(updated.diagramName).toBeNull();
  });

  it("overwrites an existing pin with a new one", () => {
    const clip = createClipOnDatabase({
      diagramSnapshotId: "snap-old",
      diagramName: "Old Diagram",
    });
    const tester = new ReducerTester(
      clipStateReducer,
      createInitialState({ items: [clip] })
    );

    const state = tester
      .send({
        type: "update-clip-diagram-pin",
        clipId: clip.frontendId,
        diagramSnapshotId: "snap-new",
        diagramName: "New Diagram",
      })
      .getState();

    const updated = state.items[0] as ClipOnDatabase;
    expect(updated.diagramSnapshotId).toBe("snap-new");
    expect(updated.diagramName).toBe("New Diagram");
  });

  it("is a no-op when frontendId does not exist", () => {
    const clip = createClipOnDatabase();
    const initialState = createInitialState({ items: [clip] });
    const tester = new ReducerTester(clipStateReducer, initialState);

    const state = tester
      .send({
        type: "update-clip-diagram-pin",
        clipId: "nonexistent" as FrontendId,
        diagramSnapshotId: "snap-123",
        diagramName: "Diagram",
      })
      .getState();

    const unchanged = state.items[0] as ClipOnDatabase;
    expect(unchanged.diagramSnapshotId).toBeNull();
    expect(unchanged.diagramName).toBeNull();
  });

  it("ignores optimistic clips (only targets on-database clips)", () => {
    const clip = createClipOnDatabase();
    const tester = new ReducerTester(
      clipStateReducer,
      createInitialState({ items: [clip] })
    );

    // Add an optimistic effect clip
    const stateWithEffect = tester
      .send({
        type: "add-effect-clip-at",
        effectType: "white-noise",
        position: "after",
        itemId: clip.frontendId,
      })
      .getState();

    const optimisticId = stateWithEffect.items[1]!.frontendId;

    // Try to pin on the optimistic clip
    const state = tester
      .send({
        type: "update-clip-diagram-pin",
        clipId: optimisticId,
        diagramSnapshotId: "snap-123",
        diagramName: "Diagram",
      })
      .getState();

    // Optimistic clip should be unchanged (no diagramSnapshotId field)
    expect(state.items[1]!.type).toBe("effect-clip-optimistically-added");
  });

  it("only updates the targeted clip when multiple clips exist", () => {
    const clip1 = createClipOnDatabase({
      diagramSnapshotId: "existing-snap",
      diagramName: "Existing",
    });
    const clip2 = createClipOnDatabase();
    const clip3 = createClipOnDatabase();
    const tester = new ReducerTester(
      clipStateReducer,
      createInitialState({ items: [clip1, clip2, clip3] })
    );

    const state = tester
      .send({
        type: "update-clip-diagram-pin",
        clipId: clip2.frontendId,
        diagramSnapshotId: "snap-new",
        diagramName: "New",
      })
      .getState();

    const c1 = state.items[0] as ClipOnDatabase;
    const c2 = state.items[1] as ClipOnDatabase;
    const c3 = state.items[2] as ClipOnDatabase;
    expect(c1.diagramSnapshotId).toBe("existing-snap");
    expect(c1.diagramName).toBe("Existing");
    expect(c2.diagramSnapshotId).toBe("snap-new");
    expect(c2.diagramName).toBe("New");
    expect(c3.diagramSnapshotId).toBeNull();
    expect(c3.diagramName).toBeNull();
  });
});
