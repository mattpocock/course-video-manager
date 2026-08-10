import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
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

describe("clipStateReducer", () => {
  describe("Deleting clips", () => {
    it("Should move the insertion point to the previous item when a chapter is deleted", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "chapter-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-2" as FrontendId,
              databaseId: "db-2" as DatabaseId,
              scene: "Clip 2",
              insertionOrder: null,
            }),
          ],
          insertionPoint: { type: "end" },
        })
      );

      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-s1" as FrontendId],
        })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items).toMatchObject([
        { scene: "Clip 1" },
        { scene: "Clip 2" },
      ]);

      // Insertion point should move to after Clip 1 (the item before the deleted section)
      expect(state.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: "fe-1",
      });
    });

    it("Should move the insertion point to end when deleting a chapter that is the first item", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "chapter-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
          ],
          insertionPoint: {
            type: "after-clip",
            frontendClipId: "fe-1" as FrontendId,
          },
        })
      );

      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-s1" as FrontendId],
        })
        .getState();

      expect(state.items).toHaveLength(1);
      expect(state.items).toMatchObject([{ scene: "Clip 1" }]);

      // No item before the deleted section, so insertion point should be "end"
      expect(state.insertionPoint).toEqual({
        type: "end",
      });
    });

    it("Should move the insertion point to the previous chapter when deleting a chapter after another section", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "chapter-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "chapter-on-database",
              frontendId: "fe-s2" as FrontendId,
              databaseId: "db-s2" as DatabaseId,
              name: "Section 2",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
          ],
          insertionPoint: {
            type: "after-clip",
            frontendClipId: "fe-1" as FrontendId,
          },
        })
      );

      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-s2" as FrontendId],
        })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items).toMatchObject([
        { name: "Section 1" },
        { scene: "Clip 1" },
      ]);

      // Should select the previous item (Section 1)
      expect(state.insertionPoint).toEqual({
        type: "after-chapter",
        frontendChapterId: "fe-s1",
      });
    });

    it("Should keep deleted database clips in items with shouldArchive for recovery", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-2" as FrontendId,
              databaseId: "db-2" as DatabaseId,
              scene: "Clip 2",
              insertionOrder: null,
            }),
          ],
          insertionPoint: { type: "end" },
        })
      );

      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-1" as FrontendId],
        })
        .getState();

      // Clip stays in items with shouldArchive
      expect(state.items).toHaveLength(2);
      expect(state.items[0]).toMatchObject({
        frontendId: "fe-1",
        type: "on-database",
        shouldArchive: true,
      });
      expect(state.items[1]).toMatchObject({
        frontendId: "fe-2",
        type: "on-database",
      });

      // Should have fired archive-clips effect
      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["db-1"],
      });
    });

    it("Should move insertion point past shouldArchive clips when finding previous item", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
              shouldArchive: true,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-2" as FrontendId,
              databaseId: "db-2" as DatabaseId,
              scene: "Clip 2",
              insertionOrder: null,
            }),
          ],
          insertionPoint: {
            type: "after-clip",
            frontendClipId: "fe-2" as FrontendId,
          },
        })
      );

      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-2" as FrontendId],
        })
        .getState();

      // Should skip fe-1 (shouldArchive) and use "end" as insertion point
      expect(state.insertionPoint).toEqual({
        type: "end",
      });
    });
  });

  describe("Deleting Latest Inserted Clip", () => {
    it("When all clips have no insertion order, the last clip should be marked shouldArchive", () => {
      const finalState = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "1",
              scene: "Scene 1",
              profile: "Profile 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "2",
              scene: "Scene 2",
              profile: "Profile 2",
              insertionOrder: null,
            }),
          ],
        })
      )
        .send(
          fromPartial({
            type: "delete-latest-inserted-clip",
          })
        )
        .getState();

      expect(finalState.items).toMatchObject([
        {
          frontendId: "1",
        },
        {
          frontendId: "2",
          shouldArchive: true,
        },
      ]);
    });

    it("Should skip already-archived optimistic clips and delete the next one (insertion point end)", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "db-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "DB Clip 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "optimistically-added",
              frontendId: "opt-1" as FrontendId,
              scene: "Opt Clip 1",
              insertionOrder: 1,
              soundDetectionId: "sound-1",
              sessionId: "session-1",
            }),
            fromPartial({
              type: "optimistically-added",
              frontendId: "opt-2" as FrontendId,
              scene: "Opt Clip 2",
              insertionOrder: 2,
              soundDetectionId: "sound-2",
              sessionId: "session-1",
            }),
          ],
          insertionPoint: { type: "end" },
        })
      );

      // First delete should mark opt-2 as shouldArchive
      const stateAfterFirst = tester
        .send({ type: "delete-latest-inserted-clip" })
        .getState();

      expect(stateAfterFirst.items).toMatchObject([
        { frontendId: "db-1", type: "on-database" },
        { frontendId: "opt-1", type: "optimistically-added" },
        {
          frontendId: "opt-2",
          type: "optimistically-added",
          shouldArchive: true,
        },
      ]);

      // Second delete should skip opt-2 (already shouldArchive) and mark opt-1
      const stateAfterSecond = tester
        .send({ type: "delete-latest-inserted-clip" })
        .getState();

      expect(stateAfterSecond.items).toMatchObject([
        { frontendId: "db-1", type: "on-database" },
        {
          frontendId: "opt-1",
          type: "optimistically-added",
          shouldArchive: true,
        },
        {
          frontendId: "opt-2",
          type: "optimistically-added",
          shouldArchive: true,
        },
      ]);
    });

    it("Should archive database clips after all optimistic clips are exhausted (insertion point end)", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "db-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "DB Clip 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "optimistically-added",
              frontendId: "opt-1" as FrontendId,
              scene: "Opt Clip 1",
              insertionOrder: 1,
              soundDetectionId: "sound-1",
              sessionId: "session-1",
            }),
          ],
          insertionPoint: { type: "end" },
        })
      );

      // First delete marks opt-1 as shouldArchive
      tester.send({ type: "delete-latest-inserted-clip" });

      // Second delete should skip opt-1 and mark db-1 as shouldArchive
      tester.resetExec();
      const stateAfterSecond = tester
        .send({ type: "delete-latest-inserted-clip" })
        .getState();

      // db-1 stays in items with shouldArchive (recoverable)
      // opt-1 remains with shouldArchive
      expect(stateAfterSecond.items).toMatchObject([
        {
          frontendId: "db-1",
          type: "on-database",
          shouldArchive: true,
        },
        {
          frontendId: "opt-1",
          type: "optimistically-added",
          shouldArchive: true,
        },
      ]);

      // Should have fired archive-clips effect for db-1
      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["db-1"],
      });
    });

    it("Should return state unchanged when all clips are already archived (insertion point end)", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "optimistically-added",
              frontendId: "opt-1" as FrontendId,
              scene: "Opt Clip 1",
              insertionOrder: 1,
              shouldArchive: true,
              soundDetectionId: "sound-1",
              sessionId: "session-1",
            }),
          ],
          insertionPoint: { type: "end" },
        })
      );

      const stateBefore = tester.getState();
      const stateAfter = tester
        .send({ type: "delete-latest-inserted-clip" })
        .getState();

      // Should be the same reference — nothing to delete
      expect(stateAfter).toBe(stateBefore);
    });
  });
});
