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
  describe("new-optimistic-clip-detected with sessions", () => {
    it("Should associate optimistic clip with active recording session", () => {
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

      const state = tester.getState();
      const clip = state.items[0] as ClipOptimisticallyAdded;
      expect(clip.sessionId).toBe(state.sessions[0]!.id);
    });

    it("Should auto-create a session if none exists when speech is detected", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      tester.send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        })
      );

      const state = tester.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]).toMatchObject({
        displayNumber: 1,
        status: "recording",
      });
      const clip = state.items[0] as ClipOptimisticallyAdded;
      expect(clip.sessionId).toBe(state.sessions[0]!.id);
    });

    it("Should associate multiple clips with the same active session", () => {
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

      const state = tester.getState();
      const sessionId = state.sessions[0]!.id;
      const clip1 = state.items[0] as ClipOptimisticallyAdded;
      const clip2 = state.items[1] as ClipOptimisticallyAdded;
      expect(clip1.sessionId).toBe(sessionId);
      expect(clip2.sessionId).toBe(sessionId);
    });

    it("Should not create a duplicate session when auto-creating and then detecting again", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

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

      const state = tester.getState();
      expect(state.sessions).toHaveLength(1);
    });
  });

  describe("restore-clip", () => {
    it("Should set shouldArchive to false on an archived optimistic clip", () => {
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

      // Archive the clip
      tester.send({ type: "clips-deleted", clipIds: [clipId] });

      const archivedClip = tester.getState()
        .items[0] as ClipOptimisticallyAdded;
      expect(archivedClip.shouldArchive).toBe(true);

      // Restore the clip
      tester.send({ type: "restore-clip", clipId });

      const restoredClip = tester.getState()
        .items[0] as ClipOptimisticallyAdded;
      expect(restoredClip.shouldArchive).toBeUndefined();
    });

    it("Should set shouldArchive to false on an archived database clip", () => {
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

      // Archive the clip, then pair with DB clip (creates ClipOnDatabase with shouldArchive)
      tester.send({ type: "clips-deleted", clipIds: [clipId] }).send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1", text: "Hello world" })],
      });

      const archivedDbClip = tester.getState().items[0] as ClipOnDatabase;
      expect(archivedDbClip.type).toBe("on-database");
      expect(archivedDbClip.shouldArchive).toBe(true);

      // Restore the clip
      tester.resetExec().send({ type: "restore-clip", clipId });

      const restoredClip = tester.getState().items[0] as ClipOnDatabase;
      expect(restoredClip.shouldArchive).toBeUndefined();
    });

    it("Should fire unarchive-clips effect for restored database clips", () => {
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

      tester.send({ type: "clips-deleted", clipIds: [clipId] }).send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1", text: "" })],
      });

      // Restore the resolved clip
      tester.resetExec().send({ type: "restore-clip", clipId });

      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "unarchive-clips",
        clipIds: ["db-1"],
      });
    });

    it("Should not fire unarchive-clips effect for restored optimistic clips", () => {
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

      tester.send({ type: "clips-deleted", clipIds: [clipId] });

      // Restore the unresolved clip
      tester.resetExec().send({ type: "restore-clip", clipId });

      expect(tester.getExec()).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "unarchive-clips" })
      );
    });

    it("Should no-op if clip is not found", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateBefore = tester.getState();
      tester.send({
        type: "restore-clip",
        clipId: "nonexistent" as FrontendId,
      });

      expect(tester.getState()).toEqual(stateBefore);
      expect(tester.getExec()).not.toHaveBeenCalled();
    });
  });

  describe("Scoped DB clip matching by outputPath", () => {
    it("should only match DB clips against optimistic clips from the session with the same outputPath", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Session 1: recording to file A, add an optimistic clip
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording-A.mkv",
          silenceLength: "short" as const,
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        )
        .send({ type: "recording-stopped" });

      const session1Id = tester.getState().sessions[0]!.id;
      const session1OutputPath = tester.getState().sessions[0]!.outputPath;

      // Session 2: recording to file B, add an optimistic clip
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording-B.mkv",
          silenceLength: "short" as const,
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        );

      const session2Id = tester.getState().sessions[1]!.id;

      // Both sessions have one optimistic clip each
      const optimisticClips = tester
        .getState()
        .items.filter((c) => c.type === "optimistically-added");
      expect(optimisticClips).toHaveLength(2);

      // DB clip arrives from file A — should only pair with session 1's clip
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1" as DatabaseId })],
        outputPath: session1OutputPath,
      });

      const stateAfter = tester.getState();

      // Session 1's clip should be resolved (on-database)
      const session1Clips = stateAfter.items.filter(
        (c) => c.type === "optimistically-added" && c.sessionId === session1Id
      );
      expect(session1Clips).toHaveLength(0); // resolved

      const resolvedClip = stateAfter.items.find(
        (c) =>
          c.type === "on-database" && c.databaseId === ("db-1" as DatabaseId)
      ) as ClipOnDatabase;
      expect(resolvedClip).toBeDefined();

      // Session 2's clip should still be optimistic (unresolved)
      const session2Clips = stateAfter.items.filter(
        (c) => c.type === "optimistically-added" && c.sessionId === session2Id
      );
      expect(session2Clips).toHaveLength(1);
    });

    it("should not match DB clips from file B against session A's optimistic clips", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Session 1: recording to file A, add two optimistic clips
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording-A.mkv",
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
        )
        .send({ type: "recording-stopped" });

      // DB clip arrives from file B (no session has this outputPath)
      // Should appear as new unpaired timeline clip
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1" as DatabaseId })],
        outputPath: "/tmp/recording-B.mkv",
      });

      const stateAfter = tester.getState();

      // Session 1's optimistic clips should both still be unresolved
      const optimisticClips = stateAfter.items.filter(
        (c) => c.type === "optimistically-added"
      );
      expect(optimisticClips).toHaveLength(2);

      // The DB clip should appear as a new unpaired clip
      const dbClips = stateAfter.items.filter((c) => c.type === "on-database");
      expect(dbClips).toHaveLength(1);
      expect((dbClips[0] as ClipOnDatabase).databaseId).toBe("db-1");
    });

    it("should fall back to global matching when outputPath is not provided (backwards compat)", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Session 1 with an optimistic clip
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

      // DB clip arrives without outputPath — should still pair (backwards compat)
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1" as DatabaseId })],
      });

      const stateAfter = tester.getState();

      // Optimistic clip should be resolved
      const optimisticClips = stateAfter.items.filter(
        (c) => c.type === "optimistically-added"
      );
      expect(optimisticClips).toHaveLength(0);

      const dbClips = stateAfter.items.filter((c) => c.type === "on-database");
      expect(dbClips).toHaveLength(1);
    });
  });
});
