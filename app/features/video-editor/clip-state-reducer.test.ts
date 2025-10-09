import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import {
  clipStateReducer,
  type DatabaseId,
} from "./clip-state-reducer";

const createMockExec = () => {
  const fn = vi.fn() as any;
  fn.stop = vi.fn();
  fn.replace = vi.fn();
  return fn;
};

describe("clipStateReducer", () => {
  describe("Transcribing", () => {
    it("should not transcribe when a new optimistic clip is added", () => {
      const reportEffect = createMockExec();
      const newState = clipStateReducer(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        fromPartial({
          type: "new-optimistic-clip-detected",
        }),
        reportEffect
      );

      const clipIds = newState.clips.map((clip) => clip.frontendId);

      expect(reportEffect).not.toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds,
      });
    });

    it("Should transcribe when a new database clip is added", () => {
      const reportEffect = createMockExec();
      const newState = clipStateReducer(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
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

      const stateAfterTranscribe = clipStateReducer(newState, {
        type: "clips-transcribed",
        clips: [
          fromPartial({ databaseId: "123" as DatabaseId, text: "Hello" }),
        ],
      }, reportEffect);

      expect(stateAfterTranscribe.clipIdsBeingTranscribed.size).toBe(0);
      expect(stateAfterTranscribe.clips[0]).toMatchObject({
        text: "Hello",
      });
    });
  });

  describe("Optimistic Clips", () => {
    it("Should handle a single optimistic clip which gets replaced with a database clip", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        fromPartial({
          type: "new-optimistic-clip-detected",
        }),
        reportEffect1
      );

      expect(stateWithOneOptimisticClip.clips[0]).toMatchObject({
        type: "optimistically-added",
      });
      expect(reportEffect1).toHaveBeenCalledWith({
        type: "scroll-to-bottom",
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

      expect(stateWithOneDatabaseClip.clips.length).toBe(1);

      expect(stateWithOneDatabaseClip.clips[0]).toMatchObject({
        type: "on-database",
        id: "123",
      });
      expect(reportEffect2).not.toHaveBeenCalledWith({
        type: "scroll-to-bottom",
      });
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });
    });

    it("Should handle two optimistic clips which get replaced with a database clip", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Camera",
          profile: "Landscape",
        }),
        reportEffect1
      );

      const stateWithTwoOptimisticClips = clipStateReducer(
        stateWithOneOptimisticClip,
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "No Face",
          profile: "Portrait",
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
        clips: [["1", { scene: "Camera", profile: "Landscape" }]],
      });

      expect(stateWithOneDatabaseClip.clips.length).toBe(2);
      expect(stateWithOneDatabaseClip.clips[0]).toMatchObject({
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
        clips: [["2", { scene: "No Face", profile: "Portrait" }]],
      });

      expect(stateWithTwoDatabaseClips.clips.length).toBe(2);
      expect(stateWithTwoDatabaseClips.clips[0]).toMatchObject({
        type: "on-database",
        id: "1",
      });
      expect(stateWithTwoDatabaseClips.clips[1]).toMatchObject({
        type: "on-database",
        id: "2",
      });
    });

    it("If there are no optimistic clips, a new database clip should be added", () => {
      const reportEffect = createMockExec();
      const stateWithASingleDatabaseClip = clipStateReducer(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        fromPartial({
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        }),
        reportEffect
      );

      expect(stateWithASingleDatabaseClip.clips.length).toBe(1);
      expect(reportEffect).toHaveBeenCalledWith({
        type: "scroll-to-bottom",
      });
    });
  });

  describe("Archiving Optimistically Added Clips", () => {
    it("Should archive an optimistically added clip when it is deleted", () => {
      const reportEffect = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        fromPartial({
          type: "new-optimistic-clip-detected",
        }),
        reportEffect
      );

      const optimisticClipId = stateWithOneOptimisticClip.clips[0]!.frontendId;

      const stateWithOneOptimisticClipDeleted = clipStateReducer(
        stateWithOneOptimisticClip,
        fromPartial({
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        }),
        reportEffect
      );

      expect(stateWithOneOptimisticClipDeleted.clips[0]).toMatchObject({
        type: "optimistically-added",
        shouldArchive: true,
      });
    });

    it("Optimistically added clips that have been archived will archive database clips that replace them", () => {
      const mockExec1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        fromPartial({
          type: "new-optimistic-clip-detected",
        }),
        mockExec1
      );

      const optimisticClipId = stateWithOneOptimisticClip.clips[0]!.frontendId;

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
      const stateWithNoDatabaseClips = clipStateReducer(
        stateWithOneOptimisticClipDeleted,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        },
        reportEffect
      );

      expect(stateWithNoDatabaseClips.clips.length).toBe(0);
      expect(reportEffect).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["123"],
      });
      expect(reportEffect).not.toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });
    });
  });

  describe("Archiving Database Clips", () => {
    it("Should archive a database clip when it is deleted", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneDatabaseClip = clipStateReducer(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        },
        reportEffect1
      );

      const databaseClipId = stateWithOneDatabaseClip.clips[0]!.frontendId;

      const reportEffect2 = createMockExec();
      const stateWithOneDatabaseClipDeleted = clipStateReducer(
        stateWithOneDatabaseClip,
        {
          type: "clips-deleted",
          clipIds: [databaseClipId],
        },
        reportEffect2
      );

      expect(stateWithOneDatabaseClipDeleted.clips.length).toBe(0);
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["123"],
      });
    });
  });
});
