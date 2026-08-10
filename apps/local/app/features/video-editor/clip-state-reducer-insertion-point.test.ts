import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { clipStateReducer } from "./clip-state-reducer";
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
  describe("Insertion Point", () => {
    it("Should allow for inserting clips at the start of the video", async () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateWithClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 1",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      const stateWithStartInsertionPoint = tester
        .send(
          fromPartial({
            type: "set-insertion-point-before",
            clipId: stateWithClips.items[0]!.frontendId,
          })
        )
        .getState();

      expect(stateWithStartInsertionPoint.insertionPoint).toEqual({
        type: "start",
      });

      const stateWithOneMoreClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      expect(stateWithOneMoreClip.items).toMatchObject([
        {
          scene: "Scene 3",
        },
        {
          scene: "Scene 1",
        },
        {
          scene: "Scene 2",
        },
      ]);

      const stateWithTwoMoreClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 4",
            soundDetectionId: "sound-4",
          })
        )
        .getState();

      expect(stateWithTwoMoreClips.items).toMatchObject([
        {
          scene: "Scene 3",
        },
        {
          scene: "Scene 4",
        },
        {
          scene: "Scene 1",
        },
        {
          scene: "Scene 2",
        },
      ]);

      const stateWithDatabaseClips = tester
        .send({
          type: "new-database-clips",
          clips: [
            fromPartial({
              id: "1",
            }),
            fromPartial({
              id: "2",
            }),
            fromPartial({
              id: "3",
            }),
            fromPartial({
              id: "4",
            }),
          ],
        })
        .getState();

      expect(stateWithDatabaseClips.items).toMatchObject([
        {
          id: "3",
          scene: "Scene 3",
        },
        {
          id: "4",
          scene: "Scene 4",
        },
        {
          id: "1",
          scene: "Scene 1",
        },
        {
          id: "2",
          scene: "Scene 2",
        },
      ]);
    });

    it("Should allow for inserting clips after a specific clip", async () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateWithClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 1",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      const stateWithEndInsertionPoint = tester
        .send(
          fromPartial({
            type: "set-insertion-point-after",
            clipId: stateWithClips.items[0]!.frontendId,
          })
        )
        .getState();

      expect(stateWithEndInsertionPoint.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithClips.items[0]!.frontendId,
      });

      const stateWithOneMoreClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      expect(stateWithOneMoreClip.items).toMatchObject([
        {
          scene: "Scene 1",
        },
        {
          scene: "Scene 3",
        },
        {
          scene: "Scene 2",
        },
      ]);

      const stateWithDatabaseClips = tester
        .send({
          type: "new-database-clips",
          clips: [
            fromPartial({ id: "1" }),
            fromPartial({ id: "2" }),
            fromPartial({ id: "3" }),
          ],
        })
        .getState();

      expect(stateWithDatabaseClips.items).toMatchObject([
        {
          id: "1",
          scene: "Scene 1",
        },
        {
          id: "3",
          scene: "Scene 3",
        },
        {
          id: "2",
          scene: "Scene 2",
        },
      ]);
    });

    it("Should handle new database clips being added after an optimistic clip", async () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateWithClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 1",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      const stateWithDatabaseClips = tester
        .send(
          fromPartial({
            type: "set-insertion-point-after",
            clipId: stateWithClips.items[0]!.frontendId,
          })
        )
        .send(
          fromPartial({
            type: "new-database-clips",
            clips: [
              fromPartial({ id: "1" }),
              fromPartial({ id: "2" }),
              fromPartial({ id: "3" }),
            ],
          })
        )
        .getState();

      expect(stateWithDatabaseClips.items).toMatchObject([
        {
          id: "1",
          scene: "Scene 1",
        },
        {
          id: "3",
        },
        {
          id: "2",
          scene: "Scene 2",
        },
      ]);
    });

    it("Should move the insertion point to the previous clip when the latest inserted clip is deleted", async () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateWithClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 1",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      const stateWithLatestInsertedClipDeleted = tester
        .send({
          type: "set-insertion-point-after",
          clipId: stateWithClips.items[0]!.frontendId,
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 3",
            soundDetectionId: "sound-3",
          })
        )
        .send({
          type: "delete-latest-inserted-clip",
        })
        .getState();

      expect(stateWithLatestInsertedClipDeleted.items).toMatchObject([
        {
          scene: "Scene 1",
        },
        {
          scene: "Scene 3",
          shouldArchive: true,
        },
        {
          scene: "Scene 2",
        },
      ]);

      // The insertion point should be after the first clip
      expect(stateWithLatestInsertedClipDeleted.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithClips.items[0]!.frontendId,
      });
    });
  });
});
