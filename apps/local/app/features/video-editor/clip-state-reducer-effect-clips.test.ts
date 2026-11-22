import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { now } from "@/packages/clock";

const createInitialState = (
  overrides: Partial<clipStateReducer.State> = {}
): clipStateReducer.State => ({
  clipIdsWithTranscriptWords: new Set(),
  items: [],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
  clipTranscriptionJobs: {},
  jobEventCursor: 0,
  micOffsetRefusal: null,
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
  transcribedAt: now(),
  transcriptionStatus: "done",
  scene: "main",
  profile: "main-camera",
  insertionOrder: 1,
  pauseType: "none",
  zoomType: "none",
  diagramSnapshotId: null,
  diagramName: null,
  webLinks: [],
  ...overrides,
});

describe("clipStateReducer - effect clips", () => {
  describe("add-effect-clip-at", () => {
    it("inserts an optimistic effect clip after the target clip", () => {
      const clip = createClipOnDatabase({ text: "Clip 1" });
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({ items: [clip] })
      );

      const state = tester
        .send({
          type: "add-effect-clip-at",
          effectType: "white-noise",
          position: "after",
          itemId: clip.frontendId,
        })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items[0]).toMatchObject({ text: "Clip 1" });
      expect(state.items[1]).toMatchObject({
        type: "effect-clip-optimistically-added",
        text: "*white noise*",
        scene: "white noise",
        pauseType: "none",
      });
    });

    it("inserts an optimistic effect clip before the target clip", () => {
      const clip = createClipOnDatabase({ text: "Clip 1" });
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({ items: [clip] })
      );

      const state = tester
        .send({
          type: "add-effect-clip-at",
          effectType: "white-noise",
          position: "before",
          itemId: clip.frontendId,
        })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items[0]).toMatchObject({
        type: "effect-clip-optimistically-added",
        text: "*white noise*",
      });
      expect(state.items[1]).toMatchObject({ text: "Clip 1" });
    });

    it("inherits profile from the adjacent clip", () => {
      const clip = createClipOnDatabase({ profile: "webcam-overlay" });
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({ items: [clip] })
      );

      const state = tester
        .send({
          type: "add-effect-clip-at",
          effectType: "white-noise",
          position: "after",
          itemId: clip.frontendId,
        })
        .getState();

      expect(state.items[1]).toMatchObject({
        profile: "webcam-overlay",
      });
    });

    it("fires create-effect-clip-at effect for database clips", () => {
      const clip = createClipOnDatabase();
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({ items: [clip] })
      );

      tester.send({
        type: "add-effect-clip-at",
        effectType: "white-noise",
        position: "after",
        itemId: clip.frontendId,
      });

      const exec = tester.getExec();
      expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "create-effect-clip-at",
          position: "after",
          targetItemId: clip.databaseId,
          targetItemType: "clip",
        })
      );
    });

    it("inserts between two existing clips at the correct position", () => {
      const clip1 = createClipOnDatabase({ text: "Clip 1" });
      const clip2 = createClipOnDatabase({ text: "Clip 2" });
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({ items: [clip1, clip2] })
      );

      const state = tester
        .send({
          type: "add-effect-clip-at",
          effectType: "white-noise",
          position: "after",
          itemId: clip1.frontendId,
        })
        .getState();

      expect(state.items).toHaveLength(3);
      expect(state.items[0]).toMatchObject({ text: "Clip 1" });
      expect(state.items[1]).toMatchObject({ text: "*white noise*" });
      expect(state.items[2]).toMatchObject({ text: "Clip 2" });
    });
  });

  describe("effect-clip-created", () => {
    it("reconciles the optimistic clip with a database ID", () => {
      const clip = createClipOnDatabase({ text: "Clip 1" });
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({ items: [clip] })
      );

      // Insert effect clip
      const stateAfterInsert = tester
        .send({
          type: "add-effect-clip-at",
          effectType: "white-noise",
          position: "after",
          itemId: clip.frontendId,
        })
        .getState();

      const optimisticId = stateAfterInsert.items[1]!.frontendId;
      const newDatabaseId = "db-effect-123" as DatabaseId;

      // Reconcile
      const state = tester
        .send({
          type: "effect-clip-created",
          frontendId: optimisticId,
          databaseId: newDatabaseId,
        })
        .getState();

      expect(state.items[1]).toMatchObject({
        type: "on-database",
        frontendId: optimisticId,
        databaseId: newDatabaseId,
        text: "*white noise*",
        scene: "white noise",
        pauseType: "none",
      });
    });
  });

  describe("deletion", () => {
    it("effect clips can be deleted like regular clips", () => {
      const clip = createClipOnDatabase({ text: "Clip 1" });
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({ items: [clip] })
      );

      // Insert effect clip
      const stateAfterInsert = tester
        .send({
          type: "add-effect-clip-at",
          effectType: "white-noise",
          position: "after",
          itemId: clip.frontendId,
        })
        .getState();

      const effectClipId = stateAfterInsert.items[1]!.frontendId;

      // Delete the effect clip
      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: [effectClipId],
        })
        .getState();

      expect(state.items).toHaveLength(1);
      expect(state.items[0]).toMatchObject({ text: "Clip 1" });
    });

    it("reconciled effect clips can be deleted via archive", () => {
      const clip = createClipOnDatabase({ text: "Clip 1" });
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({ items: [clip] })
      );

      // Insert effect clip and reconcile
      const stateAfterInsert = tester
        .send({
          type: "add-effect-clip-at",
          effectType: "white-noise",
          position: "after",
          itemId: clip.frontendId,
        })
        .getState();

      const effectClipId = stateAfterInsert.items[1]!.frontendId;

      tester.send({
        type: "effect-clip-created",
        frontendId: effectClipId,
        databaseId: "db-effect-456" as DatabaseId,
      });

      // Delete the reconciled effect clip
      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: [effectClipId],
        })
        .getState();

      // Reconciled clip is on-database, so it stays with shouldArchive for recovery
      expect(state.items).toHaveLength(2);
      expect(state.items[0]).toMatchObject({ text: "Clip 1" });
      expect(state.items[1]).toMatchObject({
        databaseId: "db-effect-456",
        shouldArchive: true,
      });
    });
  });
});
