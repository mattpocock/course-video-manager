import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOptimisticallyAdded,
  type DatabaseId,
} from "./clip-state-reducer";
import { createMockExec, ReducerTester } from "@/test-utils/reducer-tester";

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
  describe("Transcribing", () => {
    it("should not transcribe when a new optimistic clip is added", () => {
      const reportEffect = createMockExec();
      const newState = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        }),
        reportEffect
      );

      const clipIds = newState.items.map((clip) => clip.frontendId);

      expect(reportEffect).not.toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds,
      });
    });

    it("Should transcribe when a new database clip is added", () => {
      const reportEffect = createMockExec();
      const newState = clipStateReducer(
        createInitialState(),
        {
          type: "new-database-clips",
          clips: [
            fromPartial({
              id: "123",
              text: "",
            }),
          ],
        },
        reportEffect
      );

      expect(reportEffect).toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });

      expect(newState.clipIdsBeingTranscribed.size).toBe(1);

      const stateAfterTranscribe = clipStateReducer(
        newState,
        {
          type: "clips-transcribed",
          clips: [
            fromPartial({ databaseId: "123" as DatabaseId, text: "Hello" }),
          ],
        },
        reportEffect
      );

      expect(stateAfterTranscribe.clipIdsBeingTranscribed.size).toBe(0);
      expect(stateAfterTranscribe.items[0]).toMatchObject({
        text: "Hello",
      });
    });
  });

  describe("Optimistic Clips", () => {
    it("Should handle a single optimistic clip which gets replaced with a database clip", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        }),
        reportEffect1
      );

      expect(stateWithOneOptimisticClip.items[0]).toMatchObject({
        type: "optimistically-added",
      });
      expect(reportEffect1).toHaveBeenCalledWith({
        type: "scroll-to-insertion-point",
      });

      const reportEffect2 = createMockExec();
      const stateWithOneDatabaseClip = clipStateReducer(
        stateWithOneOptimisticClip,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        },
        reportEffect2
      );

      expect(stateWithOneDatabaseClip.items.length).toBe(1);

      expect(stateWithOneDatabaseClip.items[0]).toMatchObject({
        type: "on-database",
        id: "123",
      });
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "scroll-to-insertion-point",
      });
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });
    });

    it("Should handle two optimistic clips which get replaced with a database clip", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Camera",
          profile: "Landscape",
          soundDetectionId: "sound-1",
        }),
        reportEffect1
      );

      const stateWithTwoOptimisticClips = clipStateReducer(
        stateWithOneOptimisticClip,
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "No Face",
          profile: "Portrait",
          soundDetectionId: "sound-2",
        }),
        reportEffect1
      );

      const reportEffect2 = createMockExec();
      const stateWithOneDatabaseClip = clipStateReducer(
        stateWithTwoOptimisticClips,
        fromPartial({
          type: "new-database-clips",
          clips: [fromPartial({ id: "1" })],
        }),
        reportEffect2
      );

      expect(reportEffect2).toHaveBeenCalledWith({
        type: "update-clips",
        clips: [
          ["1", { scene: "Camera", profile: "Landscape", beatType: "none" }],
        ],
      });

      expect(stateWithOneDatabaseClip.items.length).toBe(2);
      expect(stateWithOneDatabaseClip.items[0]).toMatchObject({
        type: "on-database",
        id: "1",
      });

      const reportEffect3 = createMockExec();
      const stateWithTwoDatabaseClips = clipStateReducer(
        stateWithOneDatabaseClip,
        fromPartial({
          type: "new-database-clips",
          clips: [fromPartial({ id: "2" })],
        }),
        reportEffect3
      );

      expect(reportEffect3).toHaveBeenCalledWith({
        type: "update-clips",
        clips: [
          ["2", { scene: "No Face", profile: "Portrait", beatType: "none" }],
        ],
      });

      expect(stateWithTwoDatabaseClips.items.length).toBe(2);
      expect(stateWithTwoDatabaseClips.items[0]).toMatchObject({
        type: "on-database",
        id: "1",
      });
      expect(stateWithTwoDatabaseClips.items[1]).toMatchObject({
        type: "on-database",
        id: "2",
      });
    });

    it("If there are no optimistic clips, a new database clip should be added", () => {
      const reportEffect = createMockExec();
      const stateWithASingleDatabaseClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        }),
        reportEffect
      );

      expect(stateWithASingleDatabaseClip.items.length).toBe(1);
      expect(reportEffect).toHaveBeenCalledWith({
        type: "scroll-to-insertion-point",
      });
    });
  });

  describe("Archiving Optimistically Added Clips", () => {
    it("Should archive an optimistically added clip when it is deleted", () => {
      const reportEffect = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        }),
        reportEffect
      );

      const optimisticClipId = stateWithOneOptimisticClip.items[0]!.frontendId;

      const stateWithOneOptimisticClipDeleted = clipStateReducer(
        stateWithOneOptimisticClip,
        fromPartial({
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        }),
        reportEffect
      );

      expect(stateWithOneOptimisticClipDeleted.items[0]).toMatchObject({
        type: "optimistically-added",
        shouldArchive: true,
      });
    });

    it("Archived optimistic clips are converted to ClipOnDatabase with shouldArchive: true when DB clip arrives", () => {
      const mockExec1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        }),
        mockExec1
      );

      const optimisticClipId = stateWithOneOptimisticClip.items[0]!.frontendId;

      const mockExec2 = createMockExec();
      const stateWithOneOptimisticClipDeleted = clipStateReducer(
        stateWithOneOptimisticClip,
        {
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        },
        mockExec2
      );

      const reportEffect = createMockExec();
      const finalState = clipStateReducer(
        stateWithOneOptimisticClipDeleted,
        {
          type: "new-database-clips",
          clips: [
            fromPartial({
              id: "123",
              text: "",
              videoFilename: "clip.mp4",
              sourceStartTime: 0,
              sourceEndTime: 5,
            }),
          ],
        },
        reportEffect
      );

      // Clip stays in state as ClipOnDatabase with shouldArchive: true
      expect(finalState.items.length).toBe(1);
      expect(finalState.items[0]).toMatchObject({
        type: "on-database",
        databaseId: "123",
        frontendId: optimisticClipId,
        shouldArchive: true,
      });

      // Archives the clip in the DB
      expect(reportEffect).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["123"],
      });

      // Transcribes the clip so transcript text is available
      expect(reportEffect).toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });
    });

    it("Archived optimistic clips transfer scene/profile/beatType to the resulting ClipOnDatabase", () => {
      const mockExec1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
          scene: "Camera",
          profile: "TikTok",
        }),
        mockExec1
      );

      const optimisticClipId = stateWithOneOptimisticClip.items[0]!.frontendId;

      const mockExec2 = createMockExec();
      const stateWithOneOptimisticClipDeleted = clipStateReducer(
        stateWithOneOptimisticClip,
        {
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        },
        mockExec2
      );

      const reportEffect = createMockExec();
      const finalState = clipStateReducer(
        stateWithOneOptimisticClipDeleted,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "456", text: "" })],
        },
        reportEffect
      );

      expect(finalState.items[0]).toMatchObject({
        type: "on-database",
        scene: "Camera",
        profile: "TikTok",
        beatType: "none",
        shouldArchive: true,
      });

      // Scene/profile should be updated on the server too
      expect(reportEffect).toHaveBeenCalledWith({
        type: "update-clips",
        clips: [
          ["456", { scene: "Camera", profile: "TikTok", beatType: "none" }],
        ],
      });
    });
  });

  describe("Archiving Database Clips", () => {
    it("Should archive a database clip when it is deleted", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneDatabaseClip = clipStateReducer(
        createInitialState(),
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        },
        reportEffect1
      );

      const databaseClipId = stateWithOneDatabaseClip.items[0]!.frontendId;

      const reportEffect2 = createMockExec();
      const stateWithOneDatabaseClipDeleted = clipStateReducer(
        stateWithOneDatabaseClip,
        {
          type: "clips-deleted",
          clipIds: [databaseClipId],
        },
        reportEffect2
      );

      expect(stateWithOneDatabaseClipDeleted.items.length).toBe(0);
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["123"],
      });
    });
  });

  describe("Deleting Orphaned Clips", () => {
    it("Should immediately remove an orphaned clip when deleted", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
          silenceLength: "short" as const,
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        )
        .send({ type: "recording-stopped" });

      const sessionId = tester.getState().sessions[0]!.id;

      // Mark clip as orphaned via session-polling-complete
      tester.send({ type: "session-polling-complete", sessionId });

      const orphanedClip = tester.getState()
        .items[0] as ClipOptimisticallyAdded;
      expect(orphanedClip.isOrphaned).toBe(true);

      // Delete the orphaned clip
      tester.send({
        type: "clips-deleted",
        clipIds: [orphanedClip.frontendId],
      });

      // Clip should be completely removed, not marked as shouldArchive
      expect(tester.getState().items).toHaveLength(0);
    });
  });
});
