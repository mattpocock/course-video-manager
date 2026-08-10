import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type ClipOptimisticallyAdded,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { DELETED_CLIPS_SESSION_ID } from "./video-editor-selectors";

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
  describe("permanently-remove-archived", () => {
    it("Should remove all archived optimistic clips for a session", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      tester.send({
        type: "recording-started",
        outputPath: "/tmp/recording.mkv",
        silenceLength: "short" as const,
      });

      const sessionId = tester.getState().sessions[0]!.id;

      // Add two optimistic clips and archive them
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        );

      const clip1Id = tester.getState().items[0]!.frontendId;
      const clip2Id = tester.getState().items[1]!.frontendId;

      tester.send({ type: "clips-deleted", clipIds: [clip1Id, clip2Id] });

      // Both should be archived
      expect(
        (tester.getState().items[0] as ClipOptimisticallyAdded).shouldArchive
      ).toBe(true);
      expect(
        (tester.getState().items[1] as ClipOptimisticallyAdded).shouldArchive
      ).toBe(true);

      // Permanently remove all archived clips for the session
      tester.send({
        type: "permanently-remove-archived",
        sessionId,
      });

      expect(tester.getState().items).toHaveLength(0);
    });

    it("Should remove orphaned optimistic clips for a session", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      tester.send({
        type: "recording-started",
        outputPath: "/tmp/recording.mkv",
        silenceLength: "short" as const,
      });

      const sessionId = tester.getState().sessions[0]!.id;

      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        )
        .send({ type: "recording-stopped" })
        .send({ type: "session-polling-complete", sessionId });

      // Both clips should now be orphaned
      expect(
        (tester.getState().items[0] as ClipOptimisticallyAdded).isOrphaned
      ).toBe(true);
      expect(
        (tester.getState().items[1] as ClipOptimisticallyAdded).isOrphaned
      ).toBe(true);

      // Permanently remove all — should clear orphaned clips too
      tester.send({
        type: "permanently-remove-archived",
        sessionId,
      });

      expect(tester.getState().items).toHaveLength(0);
    });

    it("Should remove archived database clips for a session", () => {
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
        );

      const clipId = tester.getState().items[0]!.frontendId;

      // Archive, then pair with DB clip
      tester.send({ type: "clips-deleted", clipIds: [clipId] }).send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1", text: "Hello world" })],
      });

      const sessionId = tester.getState().sessions[0]!.id;
      const archivedDbClip = tester.getState().items[0] as ClipOnDatabase;
      expect(archivedDbClip.shouldArchive).toBe(true);

      // Permanently remove
      tester.resetExec().send({
        type: "permanently-remove-archived",
        sessionId,
      });

      expect(tester.getState().items).toHaveLength(0);
    });

    it("Should not affect clips from other sessions", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Session 1: create and archive a clip
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
        );

      const session1Id = tester.getState().sessions[0]!.id;
      const clip1Id = tester.getState().items[0]!.frontendId;
      tester
        .send({ type: "clips-deleted", clipIds: [clip1Id] })
        .send({ type: "recording-stopped" });

      // Session 2: create and archive a clip
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
          silenceLength: "short" as const,
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        );

      const clip2Id = tester.getState().items[1]!.frontendId;
      tester.send({ type: "clips-deleted", clipIds: [clip2Id] });

      expect(tester.getState().items).toHaveLength(2);

      // Remove only session 1's archived clips
      tester.send({
        type: "permanently-remove-archived",
        sessionId: session1Id,
      });

      // Session 2's archived clip should remain
      expect(tester.getState().items).toHaveLength(1);
      expect(tester.getState().items[0]!.frontendId).toBe(clip2Id);
    });

    it("Should not affect non-archived clips in the same session", () => {
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
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        );

      const sessionId = tester.getState().sessions[0]!.id;
      const clip1Id = tester.getState().items[0]!.frontendId;

      // Archive only clip 1, leave clip 2 pending
      tester.send({ type: "clips-deleted", clipIds: [clip1Id] });

      // Permanently remove archived clips
      tester.send({
        type: "permanently-remove-archived",
        sessionId,
      });

      // Clip 2 (non-archived) should remain
      expect(tester.getState().items).toHaveLength(1);
      expect(
        (tester.getState().items[0] as ClipOptimisticallyAdded).shouldArchive
      ).toBeUndefined();
    });

    it("Should no-op if no archived clips exist for the session", () => {
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
        );

      const sessionId = tester.getState().sessions[0]!.id;
      const stateBefore = tester.getState();

      tester.send({
        type: "permanently-remove-archived",
        sessionId,
      });

      expect(tester.getState()).toEqual(stateBefore);
    });

    it("Should cause unpaired DB clips arriving later to appear as new timeline clips", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Start recording, add two optimistic clips, archive them
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
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        );

      const sessionId = tester.getState().sessions[0]!.id;
      const clip1Id = tester.getState().items[0]!.frontendId;
      const clip2Id = tester.getState().items[1]!.frontendId;

      // Delete both clips (archive them)
      tester.send({ type: "clips-deleted", clipIds: [clip1Id, clip2Id] });

      expect(tester.getState().items).toHaveLength(2);
      expect(
        (tester.getState().items[0] as ClipOptimisticallyAdded).shouldArchive
      ).toBe(true);

      // "Clear all" — permanently removes archived clips before DB clips arrive
      tester.send({
        type: "permanently-remove-archived",
        sessionId,
      });

      expect(tester.getState().items).toHaveLength(0);

      // DB clips arrive after clear all — should appear as new unpaired clips
      tester.resetExec().send({
        type: "new-database-clips",
        clips: [
          fromPartial({ id: "db-1" as DatabaseId, text: "First clip" }),
          fromPartial({ id: "db-2" as DatabaseId, text: "Second clip" }),
        ],
      });

      // Both should appear as new timeline clips (not archived)
      expect(tester.getState().items).toHaveLength(2);

      const newClip1 = tester.getState().items[0] as ClipOnDatabase;
      const newClip2 = tester.getState().items[1] as ClipOnDatabase;

      expect(newClip1.type).toBe("on-database");
      expect(newClip1.databaseId).toBe("db-1");
      expect(newClip1.shouldArchive).toBeUndefined();
      // New frontend IDs — not the original archived clip IDs
      expect(newClip1.frontendId).not.toBe(clip1Id);
      expect(newClip1.frontendId).not.toBe(clip2Id);

      expect(newClip2.type).toBe("on-database");
      expect(newClip2.databaseId).toBe("db-2");
      expect(newClip2.shouldArchive).toBeUndefined();
      expect(newClip2.frontendId).not.toBe(clip1Id);
      expect(newClip2.frontendId).not.toBe(clip2Id);
    });

    it("Should remove session-less archived clips when using DELETED_CLIPS_SESSION_ID", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              shouldArchive: true,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-2" as FrontendId,
              databaseId: "db-2" as DatabaseId,
              shouldArchive: true,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-3" as FrontendId,
              databaseId: "db-3" as DatabaseId,
            }),
          ],
        })
      );

      tester.send({
        type: "permanently-remove-archived",
        sessionId: DELETED_CLIPS_SESSION_ID,
      });

      // Only the non-archived clip remains
      expect(tester.getState().items).toHaveLength(1);
      expect(tester.getState().items[0]!.frontendId).toBe("fe-3" as FrontendId);
    });
  });

  describe("permanently-remove-all-archived", () => {
    it("Should remove archived and orphaned clips across all sessions", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Session 1: create and archive a clip
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
        );

      const clip1Id = tester.getState().items[0]!.frontendId;
      tester
        .send({ type: "clips-deleted", clipIds: [clip1Id] })
        .send({ type: "recording-stopped" });

      // Session 2: create and archive a clip
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording2.mkv",
          silenceLength: "short" as const,
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        );

      const clip2Id = tester.getState().items[1]!.frontendId;
      tester.send({ type: "clips-deleted", clipIds: [clip2Id] });

      expect(tester.getState().items).toHaveLength(2);

      // Clear all archived across all sessions
      tester.send({
        type: "permanently-remove-all-archived",
      });

      expect(tester.getState().items).toHaveLength(0);
    });

    it("Should not affect non-archived clips", () => {
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
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        );

      const clip1Id = tester.getState().items[0]!.frontendId;

      // Archive only clip 1, leave clip 2 pending
      tester.send({ type: "clips-deleted", clipIds: [clip1Id] });

      // Clear all archived
      tester.send({
        type: "permanently-remove-all-archived",
      });

      // Clip 2 (non-archived) should remain
      expect(tester.getState().items).toHaveLength(1);
      expect(
        (tester.getState().items[0] as ClipOptimisticallyAdded).shouldArchive
      ).toBeUndefined();
    });

    it("Should no-op if no archived clips exist", () => {
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
        );

      const stateBefore = tester.getState();

      tester.send({
        type: "permanently-remove-all-archived",
      });

      expect(tester.getState()).toEqual(stateBefore);
    });
  });
});
