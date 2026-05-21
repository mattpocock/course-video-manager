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
  describe("Appending optimistic clips with sections present", () => {
    it("Should append optimistic clips at end when sections exist", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add clip, section, clip - then append more at end
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 1",
            soundDetectionId: "sound-1",
          })
        )
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        );

      // Now add more clips - should append after Clip 2
      const state = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      expect(state.items).toHaveLength(4);
      expect(state.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
        { scene: "Clip 2" },
        { scene: "Clip 3" },
      ]);
    });

    it("Should replace optimistic clips with database clips when sections are interleaved", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add clip, section, clip
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 1",
            soundDetectionId: "sound-1",
          })
        )
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        );

      // Replace first optimistic clip with database clip
      const stateAfterFirstDb = tester
        .send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-1" })],
        })
        .getState();

      expect(stateAfterFirstDb.items).toHaveLength(3);
      expect(stateAfterFirstDb.items[0]).toMatchObject({
        type: "on-database",
        id: "db-1",
      });
      // Section should still be in position 1
      expect(stateAfterFirstDb.items[1]).toMatchObject({
        name: "Section 1",
      });
      // Second clip still optimistic
      expect(stateAfterFirstDb.items[2]).toMatchObject({
        type: "optimistically-added",
        scene: "Clip 2",
      });

      // Replace second optimistic clip with database clip
      const stateAfterSecondDb = tester
        .send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-2" })],
        })
        .getState();

      expect(stateAfterSecondDb.items).toHaveLength(3);
      expect(stateAfterSecondDb.items).toMatchObject([
        { type: "on-database", id: "db-1" },
        { name: "Section 1" },
        { type: "on-database", id: "db-2" },
      ]);
    });

    it("Should handle multiple sequential optimistic clips after a section, then replace them", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add section first
      tester.send({
        type: "add-chapter",
        name: "Section 1",
      });

      // Add 3 clips after section
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip A",
            soundDetectionId: "sound-a",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip B",
            soundDetectionId: "sound-b",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip C",
            soundDetectionId: "sound-c",
          })
        );

      const stateBeforeDb = tester.getState();
      expect(stateBeforeDb.items).toHaveLength(4);
      expect(stateBeforeDb.items).toMatchObject([
        { name: "Section 1" },
        { scene: "Clip A" },
        { scene: "Clip B" },
        { scene: "Clip C" },
      ]);

      // Replace all three with database clips one at a time
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-a" })],
      });
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-b" })],
      });
      const finalState = tester
        .send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-c" })],
        })
        .getState();

      expect(finalState.items).toHaveLength(4);
      expect(finalState.items).toMatchObject([
        { name: "Section 1" },
        { type: "on-database", id: "db-a" },
        { type: "on-database", id: "db-b" },
        { type: "on-database", id: "db-c" },
      ]);
    });

    it("Should not displace sections when database clips arrive without matching optimistic clips", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Existing Clip",
              insertionOrder: null,
            }),
            fromPartial({
              type: "chapter-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
          ],
        })
      );

      // A new database clip arrives with no matching optimistic clip
      // (e.g., from page refresh or another source)
      const state = tester
        .send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-2" })],
        })
        .getState();

      // The new clip should be at the end (default insertion point),
      // section should stay in position
      expect(state.items).toHaveLength(3);
      expect(state.items[0]).toMatchObject({
        type: "on-database",
        databaseId: "db-1",
      });
      expect(state.items[1]).toMatchObject({
        name: "Section 1",
      });
      expect(state.items[2]).toMatchObject({
        type: "on-database",
        databaseId: "db-2",
      });
    });

    it("Should correctly handle insertion point after section when appending new clips from OBS", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add first clip
      tester.send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Clip 1",
          soundDetectionId: "sound-1",
        })
      );

      // Add section - insertion point moves to after-chapter
      const stateWithSection = tester
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .getState();

      expect(stateWithSection.insertionPoint).toEqual({
        type: "after-chapter",
        frontendChapterId: stateWithSection.items[1]!.frontendId,
      });

      // First OBS clip after section
      const stateWithClip2 = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      // Insertion point should move to after-clip (clip 2)
      expect(stateWithClip2.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithClip2.items[2]!.frontendId,
      });

      // Second OBS clip - should go after clip 2, not after section
      const stateWithClip3 = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      expect(stateWithClip3.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
        { scene: "Clip 2" },
        { scene: "Clip 3" },
      ]);
    });
  });

  describe("Moving clips around sections", () => {
    it("Should fire reorder-clip effect when moving a database clip up past a section", () => {
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
        })
      );

      // Move Clip 2 up - should swap with section
      const state = tester
        .send({
          type: "move-clip",
          clipId: "fe-2" as FrontendId,
          direction: "up",
        })
        .getState();

      expect(state.items).toMatchObject([
        { scene: "Clip 1" },
        { scene: "Clip 2" },
        { name: "Section 1" },
      ]);

      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "reorder-clip",
        clipId: "db-2",
        direction: "up",
      });
    });

    it("Should fire reorder-chapter effect when moving a section down", () => {
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
        })
      );

      // Move section down - should swap with Clip 1
      const state = tester
        .send({
          type: "move-clip",
          clipId: "fe-s1" as FrontendId,
          direction: "down",
        })
        .getState();

      expect(state.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
      ]);

      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "reorder-chapter",
        chapterId: "db-s1",
        direction: "down",
      });
    });

    it("Should handle moving the first clip down past a section", () => {
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
        })
      );

      // Move Clip 1 down - should swap with section
      const state = tester
        .send({
          type: "move-clip",
          clipId: "fe-1" as FrontendId,
          direction: "down",
        })
        .getState();

      expect(state.items).toMatchObject([
        { name: "Section 1" },
        { scene: "Clip 1" },
        { scene: "Clip 2" },
      ]);
    });
  });

  describe("Deleting clips with sections", () => {
    it("Should move insertion point correctly when deleting a clip between sections", () => {
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
            fromPartial({
              type: "chapter-on-database",
              frontendId: "fe-s2" as FrontendId,
              databaseId: "db-s2" as DatabaseId,
              name: "Section 2",
              insertionOrder: null,
            }),
          ],
          insertionPoint: {
            type: "after-clip",
            frontendClipId: "fe-1" as FrontendId,
          },
        })
      );

      // Delete Clip 1 - insertion point should move to previous item (Section 1)
      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-1" as FrontendId],
        })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items).toMatchObject([
        { name: "Section 1" },
        { name: "Section 2" },
      ]);

      expect(state.insertionPoint).toEqual({
        type: "after-chapter",
        frontendChapterId: "fe-s1",
      });
    });

    it("Should handle delete-latest-inserted-clip when insertion point is after a section", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add a clip, section, then another clip
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 1",
            soundDetectionId: "sound-1",
          })
        )
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        );

      // Delete latest inserted clip (Clip 2)
      const stateAfterDelete = tester
        .send({
          type: "delete-latest-inserted-clip",
        })
        .getState();

      // Clip 2 should be marked for archive, insertion point should move to section
      expect(stateAfterDelete.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
        { scene: "Clip 2", shouldArchive: true },
      ]);

      // Insertion point should be after the section (the previous item)
      expect(stateAfterDelete.insertionPoint).toEqual({
        type: "after-chapter",
        frontendChapterId: stateAfterDelete.items[1]!.frontendId,
      });
    });
  });
});
