import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import {
  clipStateReducer,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";

describe("clipStateReducer", () => {
  describe("Transcribing", () => {
    it("should not transcribe when a new optimistic clip is added", () => {
      const reportEffect = vi.fn();
      const newState = clipStateReducer(reportEffect)(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        {
          type: "new-optimistic-clip-detected",
          scene: "Unknown",
        }
      );

      const clipIds = newState.clips.map((clip) => clip.frontendId);

      expect(reportEffect).not.toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds,
      });
    });

    it("Should transcribe when a new database clip is added", () => {
      const reportEffect = vi.fn();
      const newState = clipStateReducer(reportEffect)(
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
        }
      );

      expect(reportEffect).toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });

      expect(newState.clipIdsBeingTranscribed.size).toBe(1);

      const stateAfterTranscribe = clipStateReducer(reportEffect)(newState, {
        type: "clips-transcribed",
        clips: [
          fromPartial({ databaseId: "123" as DatabaseId, text: "Hello" }),
        ],
      });

      expect(stateAfterTranscribe.clipIdsBeingTranscribed.size).toBe(0);
      expect(stateAfterTranscribe.clips[0]).toMatchObject({
        text: "Hello",
      });
    });
  });

  describe("Optimistic Clips", () => {
    it("Should handle a single optimistic clip which gets replaced with a database clip", () => {
      const reportEffect1 = vi.fn();
      const stateWithOneOptimisticClip = clipStateReducer(reportEffect1)(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        {
          type: "new-optimistic-clip-detected",
          scene: "Unknown",
        }
      );

      expect(stateWithOneOptimisticClip.clips[0]).toMatchObject({
        type: "optimistically-added",
      });
      expect(reportEffect1).toHaveBeenCalledWith({
        type: "scroll-to-bottom",
      });

      const reportEffect2 = vi.fn();
      const stateWithOneDatabaseClip = clipStateReducer(reportEffect2)(
        stateWithOneOptimisticClip,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        }
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
      const reportEffect1 = vi.fn();
      const stateWithOneOptimisticClip = clipStateReducer(reportEffect1)(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        {
          type: "new-optimistic-clip-detected",
          scene: "Camera",
        }
      );

      const stateWithTwoOptimisticClips = clipStateReducer(reportEffect1)(
        stateWithOneOptimisticClip,
        {
          type: "new-optimistic-clip-detected",
          scene: "No Face",
        }
      );

      const reportEffect2 = vi.fn();
      const stateWithOneDatabaseClip = clipStateReducer(reportEffect2)(
        stateWithTwoOptimisticClips,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "1" })],
        }
      );

      expect(reportEffect2).toHaveBeenCalledWith({
        type: "update-clips-scene",
        clips: [["1", "Camera"]],
      });

      expect(stateWithOneDatabaseClip.clips.length).toBe(2);
      expect(stateWithOneDatabaseClip.clips[0]).toMatchObject({
        type: "on-database",
        id: "1",
      });

      const reportEffect3 = vi.fn();
      const stateWithTwoDatabaseClips = clipStateReducer(reportEffect3)(
        stateWithOneDatabaseClip,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "2" })],
        }
      );

      expect(reportEffect3).toHaveBeenCalledWith({
        type: "update-clips-scene",
        clips: [["2", "No Face"]],
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
      const reportEffect = vi.fn();
      const stateWithASingleDatabaseClip = clipStateReducer(reportEffect)(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        }
      );

      expect(stateWithASingleDatabaseClip.clips.length).toBe(1);
      expect(reportEffect).toHaveBeenCalledWith({
        type: "scroll-to-bottom",
      });
    });
  });

  describe("Archiving Optimistically Added Clips", () => {
    it("Should archive an optimistically added clip when it is deleted", () => {
      const reportEffect = vi.fn();
      const stateWithOneOptimisticClip = clipStateReducer(reportEffect)(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        {
          type: "new-optimistic-clip-detected",
          scene: "Unknown",
        }
      );

      const optimisticClipId = stateWithOneOptimisticClip.clips[0]!.frontendId;

      const stateWithOneOptimisticClipDeleted = clipStateReducer(reportEffect)(
        stateWithOneOptimisticClip,
        {
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        }
      );

      expect(stateWithOneOptimisticClipDeleted.clips[0]).toMatchObject({
        type: "optimistically-added",
        shouldArchive: true,
      });
    });

    it("Optimistically added clips that have been archived will archive database clips that replace them", () => {
      const stateWithOneOptimisticClip = clipStateReducer(() => {})(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        {
          type: "new-optimistic-clip-detected",
          scene: "Unknown",
        }
      );

      const optimisticClipId = stateWithOneOptimisticClip.clips[0]!.frontendId;

      const stateWithOneOptimisticClipDeleted = clipStateReducer(() => {})(
        stateWithOneOptimisticClip,
        {
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        }
      );

      const reportEffect = vi.fn();
      const stateWithNoDatabaseClips = clipStateReducer(reportEffect)(
        stateWithOneOptimisticClipDeleted,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        }
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
      const reportEffect1 = vi.fn();
      const stateWithOneDatabaseClip = clipStateReducer(reportEffect1)(
        {
          clips: [],
          clipIdsBeingTranscribed: new Set(),
        },
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        }
      );

      const databaseClipId = stateWithOneDatabaseClip.clips[0]!.frontendId;

      const reportEffect2 = vi.fn();
      const stateWithOneDatabaseClipDeleted = clipStateReducer(reportEffect2)(
        stateWithOneDatabaseClip,
        {
          type: "clips-deleted",
          clipIds: [databaseClipId],
        }
      );

      expect(stateWithOneDatabaseClipDeleted.clips.length).toBe(0);
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["123"],
      });
    });
  });
});
