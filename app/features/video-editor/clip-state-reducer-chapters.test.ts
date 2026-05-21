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
  describe("Inserting clips with chapters", () => {
    it("Should correctly insert a clip just before a section (after a clip that precedes the section)", () => {
      // Setup: Clip 1 -> Section -> Clip 2
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add first clip
      const stateWithFirstClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 1",
            soundDetectionId: "sound-1",
          })
        )
        .getState();

      const firstClipId = stateWithFirstClip.items[0]!.frontendId;

      // Add section after first clip
      const stateWithSection = tester
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .getState();

      const sectionId = stateWithSection.items[1]!.frontendId;

      // Add second clip after section
      const stateWithTwoClipsAndSection = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      // Verify structure: [Clip 1, Section, Clip 2]
      expect(stateWithTwoClipsAndSection.items).toHaveLength(3);
      expect(stateWithTwoClipsAndSection.items[0]).toMatchObject({
        scene: "Clip 1",
      });
      expect(stateWithTwoClipsAndSection.items[1]).toMatchObject({
        name: "Section 1",
      });
      expect(stateWithTwoClipsAndSection.items[2]).toMatchObject({
        scene: "Clip 2",
      });

      // Now set insertion point BEFORE the section (which means after Clip 1)
      const stateWithInsertionBeforeSection = tester
        .send({
          type: "set-insertion-point-before",
          clipId: sectionId,
        })
        .getState();

      // Insertion point should be after Clip 1
      expect(stateWithInsertionBeforeSection.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: firstClipId,
      });

      // Insert a new clip (Clip 3) at this insertion point
      const stateWithNewClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      // Verify structure: [Clip 1, Clip 3, Section, Clip 2]
      expect(stateWithNewClip.items).toHaveLength(4);
      expect(stateWithNewClip.items).toMatchObject([
        { scene: "Clip 1" },
        { scene: "Clip 3" },
        { name: "Section 1" },
        { scene: "Clip 2" },
      ]);

      // Insertion point should now be after Clip 3
      expect(stateWithNewClip.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithNewClip.items[1]!.frontendId,
      });
    });

    it("Should correctly handle insertion point when setting it before a section at the start", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add section at start
      const stateWithSection = tester
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .getState();

      const sectionId = stateWithSection.items[0]!.frontendId;

      // Add clip after section
      tester.send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Clip 1",
          soundDetectionId: "sound-1",
        })
      );

      // Set insertion point before the section (should be "start")
      const stateWithInsertionBeforeSection = tester
        .send({
          type: "set-insertion-point-before",
          clipId: sectionId,
        })
        .getState();

      expect(stateWithInsertionBeforeSection.insertionPoint).toEqual({
        type: "start",
      });

      // Insert a new clip (should go before the section)
      const stateWithNewClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      // Verify structure: [Clip 2, Section, Clip 1]
      expect(stateWithNewClip.items).toMatchObject([
        { scene: "Clip 2" },
        { name: "Section 1" },
        { scene: "Clip 1" },
      ]);
    });

    it("Should correctly insert clips after a section", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add clip
      tester.send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Clip 1",
          soundDetectionId: "sound-1",
        })
      );

      // Add section
      const stateWithSection = tester
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .getState();

      // Insertion point should now be after the section
      expect(stateWithSection.insertionPoint).toEqual({
        type: "after-chapter",
        frontendChapterId: stateWithSection.items[1]!.frontendId,
      });

      // Insert a new clip after the section
      const stateWithNewClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      // Verify structure: [Clip 1, Section, Clip 2]
      expect(stateWithNewClip.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
        { scene: "Clip 2" },
      ]);

      // Insertion point should be after Clip 2
      expect(stateWithNewClip.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithNewClip.items[2]!.frontendId,
      });
    });
  });

  describe("Adding chapter after optimistic chapter", () => {
    it("Should add a chapter after an optimistically added chapter", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add first section via add-chapter (creates an optimistically added section)
      const stateWithFirstSection = tester
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .getState();

      expect(stateWithFirstSection.items).toHaveLength(1);
      expect(stateWithFirstSection.items[0]).toMatchObject({
        type: "chapter-optimistically-added",
        name: "Section 1",
      });

      const firstSectionId = stateWithFirstSection.items[0]!.frontendId;

      // Now add another section after the optimistic section via add-chapter-at
      const stateWithSecondSection = tester
        .send({
          type: "add-chapter-at",
          name: "Section 2",
          position: "after",
          itemId: firstSectionId,
        })
        .getState();

      // Should have both sections
      expect(stateWithSecondSection.items).toHaveLength(2);
      expect(stateWithSecondSection.items).toMatchObject([
        { name: "Section 1" },
        { name: "Section 2" },
      ]);
    });

    it("Should add a chapter before an optimistically added chapter", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add first section
      const stateWithFirstSection = tester
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .getState();

      const firstSectionId = stateWithFirstSection.items[0]!.frontendId;

      // Add section before the optimistic section
      const stateWithSecondSection = tester
        .send({
          type: "add-chapter-at",
          name: "Section 0",
          position: "before",
          itemId: firstSectionId,
        })
        .getState();

      expect(stateWithSecondSection.items).toHaveLength(2);
      expect(stateWithSecondSection.items).toMatchObject([
        { name: "Section 0" },
        { name: "Section 1" },
      ]);
    });
  });

  describe("Chapter lifecycle (optimistic → on-database)", () => {
    it("Should transition an optimistic chapter to on-database when chapter-created is dispatched", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add an optimistic section
      const stateWithSection = tester
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .getState();

      expect(stateWithSection.items[0]).toMatchObject({
        type: "chapter-optimistically-added",
        name: "Section 1",
      });

      const frontendId = stateWithSection.items[0]!.frontendId;

      // Simulate the DB responding with the created section
      const stateAfterCreated = tester
        .send(
          fromPartial({
            type: "chapter-created",
            frontendId,
            databaseId: "db-s1",
          })
        )
        .getState();

      // Should now be on-database
      expect(stateAfterCreated.items[0]).toMatchObject({
        type: "chapter-on-database",
        frontendId,
        databaseId: "db-s1",
        name: "Section 1",
      });
    });

    it("Should replace all chapters when chapters-replaced is dispatched", () => {
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
              frontendId: "fe-old-s" as FrontendId,
              databaseId: "db-old-s" as DatabaseId,
              name: "Old Section",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-2" as FrontendId,
              databaseId: "db-2" as DatabaseId,
              scene: "Clip 2",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-3" as FrontendId,
              databaseId: "db-3" as DatabaseId,
              scene: "Clip 3",
              insertionOrder: null,
            }),
          ],
        })
      );

      const state = tester
        .send({
          type: "chapters-replaced",
          sections: [
            {
              databaseId: "db-new-s1" as DatabaseId,
              name: "New Section A",
              beforeClipDatabaseId: "db-1" as DatabaseId,
            },
            {
              databaseId: "db-new-s2" as DatabaseId,
              name: "New Section B",
              beforeClipDatabaseId: "db-3" as DatabaseId,
            },
          ],
        })
        .getState();

      expect(state.items).toHaveLength(5);
      expect(state.items[0]).toMatchObject({
        type: "chapter-on-database",
        databaseId: "db-new-s1",
        name: "New Section A",
      });
      expect(state.items[1]).toMatchObject({
        type: "on-database",
        databaseId: "db-1",
      });
      expect(state.items[2]).toMatchObject({
        type: "on-database",
        databaseId: "db-2",
      });
      expect(state.items[3]).toMatchObject({
        type: "chapter-on-database",
        databaseId: "db-new-s2",
        name: "New Section B",
      });
      expect(state.items[4]).toMatchObject({
        type: "on-database",
        databaseId: "db-3",
      });

      // No old section remains
      expect(
        state.items.find(
          (i) => i.type === "chapter-on-database" && i.databaseId === "db-old-s"
        )
      ).toBeUndefined();
    });

    it("Should remove all sections when chapters-replaced is dispatched with empty array", () => {
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
              frontendId: "fe-s" as FrontendId,
              databaseId: "db-s" as DatabaseId,
              name: "Old Section",
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

      const state = tester
        .send({ type: "chapters-replaced", sections: [] })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items.every((i) => i.type === "on-database")).toBe(true);
    });

    it("Should skip new sections whose beforeClipDatabaseId is not in items", () => {
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
          ],
        })
      );

      const state = tester
        .send({
          type: "chapters-replaced",
          sections: [
            {
              databaseId: "db-new-s" as DatabaseId,
              name: "Ghost",
              beforeClipDatabaseId: "db-missing" as DatabaseId,
            },
          ],
        })
        .getState();

      expect(state.items).toHaveLength(1);
      expect(state.items[0]).toMatchObject({ databaseId: "db-1" });
    });

    it("Should reset insertion point to end when it pointed at a removed section", () => {
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
              frontendId: "fe-old-s" as FrontendId,
              databaseId: "db-old-s" as DatabaseId,
              name: "Old",
              insertionOrder: null,
            }),
          ],
          insertionPoint: {
            type: "after-chapter",
            frontendChapterId: "fe-old-s" as FrontendId,
          },
        })
      );

      const state = tester
        .send({ type: "chapters-replaced", sections: [] })
        .getState();

      expect(state.insertionPoint).toEqual({ type: "end" });
    });

    it("Should preserve insertion point that targets a still-present clip", () => {
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
              frontendId: "fe-old-s" as FrontendId,
              databaseId: "db-old-s" as DatabaseId,
              name: "Old",
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
        .send({ type: "chapters-replaced", sections: [] })
        .getState();

      expect(state.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: "fe-1",
      });
    });

    it("Should fire reorder-chapter effect when moving a section that was optimistic but has been persisted", () => {
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
          ],
        })
      );

      // Add an optimistic section after Clip 1
      const stateWithSection = tester
        .send({
          type: "add-chapter",
          name: "Section 1",
        })
        .getState();

      const sectionFrontendId = stateWithSection.items[1]!.frontendId;

      // Simulate DB response - section now has a database ID
      tester.send(
        fromPartial({
          type: "chapter-created",
          frontendId: sectionFrontendId,
          databaseId: "db-s1",
        })
      );

      // Move the section up past Clip 1
      tester.send({
        type: "move-clip",
        clipId: sectionFrontendId,
        direction: "up",
      });

      // The reorder effect should have fired with the database ID
      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "reorder-chapter",
        chapterId: "db-s1",
        direction: "up",
      });
    });
  });
});
