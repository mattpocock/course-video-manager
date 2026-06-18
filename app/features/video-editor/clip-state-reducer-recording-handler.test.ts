import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import type {
  ClipOptimisticallyAdded,
  ClipReducerExec,
  ClipReducerState,
} from "./clip-state-reducer.types";
import {
  handleRecordingAction,
  isRecordingAction,
} from "./clip-state-reducer-recording";

const createRecordingState = (
  overrides: Partial<ClipReducerState> = {}
): ClipReducerState => ({
  items: [],
  clipIdsBeingTranscribed: new Set(),
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
  ...overrides,
});

const createExec = (): ClipReducerExec => vi.fn();

describe("recording session sub-handler", () => {
  describe("isRecordingAction", () => {
    it("returns true for recording-started", () => {
      expect(
        isRecordingAction(fromPartial({ type: "recording-started" }))
      ).toBe(true);
    });

    it("returns false for non-recording actions", () => {
      expect(isRecordingAction(fromPartial({ type: "clips-deleted" }))).toBe(
        false
      );
    });
  });

  describe("recording-started", () => {
    it("creates a new session with displayNumber 1", () => {
      const exec = createExec();
      const state = handleRecordingAction(
        createRecordingState(),
        {
          type: "recording-started",
          outputPath: "/tmp/rec.mkv",
          pauseLength: "short",
        },
        exec
      );

      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]).toMatchObject({
        displayNumber: 1,
        status: "recording",
        outputPath: "/tmp/rec.mkv",
      });
    });

    it("fires start-session-polling and scroll-to-insertion-point effects", () => {
      const exec = createExec();
      handleRecordingAction(
        createRecordingState(),
        {
          type: "recording-started",
          outputPath: "/tmp/rec.mkv",
          pauseLength: "short",
        },
        exec
      );

      expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "start-session-polling",
          outputPath: "/tmp/rec.mkv",
          pauseLength: "short",
        })
      );
      expect(exec).toHaveBeenCalledWith({ type: "scroll-to-insertion-point" });
    });
  });

  describe("recording-stopped", () => {
    it("transitions active session to polling", () => {
      const exec = createExec();
      let state = handleRecordingAction(
        createRecordingState(),
        {
          type: "recording-started",
          outputPath: "/tmp/rec.mkv",
          pauseLength: "short",
        },
        exec
      );

      state = handleRecordingAction(
        state,
        { type: "recording-stopped" },
        createExec()
      );

      expect(state.sessions[0]).toMatchObject({ status: "polling" });
    });

    it("no-ops if no session is recording", () => {
      const exec = createExec();
      const initial = createRecordingState();
      const state = handleRecordingAction(
        initial,
        { type: "recording-stopped" },
        exec
      );

      expect(state).toBe(initial);
      expect(exec).not.toHaveBeenCalled();
    });
  });

  describe("session-polling-complete", () => {
    it("marks orphaned optimistic clips for the completed session", () => {
      const exec = createExec();
      let state = handleRecordingAction(
        createRecordingState(),
        {
          type: "recording-started",
          outputPath: "/tmp/rec.mkv",
          pauseLength: "short",
        },
        exec
      );

      state = handleRecordingAction(
        state,
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "s1",
        }),
        createExec()
      );

      state = handleRecordingAction(
        state,
        { type: "recording-stopped" },
        createExec()
      );

      const sessionId = state.sessions[0]!.id;

      state = handleRecordingAction(
        state,
        { type: "session-polling-complete", sessionId },
        createExec()
      );

      expect(state.sessions[0]).toMatchObject({ status: "done" });
      const clip = state.items[0] as ClipOptimisticallyAdded;
      expect(clip.isOrphaned).toBe(true);
    });
  });

  describe("new-optimistic-clip-detected", () => {
    it("adds an optimistic clip tied to the active session", () => {
      const exec = createExec();
      let state = handleRecordingAction(
        createRecordingState(),
        {
          type: "recording-started",
          outputPath: "/tmp/rec.mkv",
          pauseLength: "short",
        },
        exec
      );

      state = handleRecordingAction(
        state,
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "s1",
        }),
        createExec()
      );

      expect(state.items).toHaveLength(1);
      const clip = state.items[0] as ClipOptimisticallyAdded;
      expect(clip.type).toBe("optimistically-added");
      expect(clip.sessionId).toBe(state.sessions[0]!.id);
    });
  });

  describe("new-database-clips", () => {
    it("pairs database clip with optimistic clip", () => {
      const exec = createExec();
      let state = handleRecordingAction(
        createRecordingState(),
        {
          type: "recording-started",
          outputPath: "/tmp/rec.mkv",
          pauseLength: "short",
        },
        exec
      );

      state = handleRecordingAction(
        state,
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "s1",
        }),
        createExec()
      );

      const dbExec = createExec();
      state = handleRecordingAction(
        state,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-1", text: "Hello" })],
        },
        dbExec
      );

      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.type).toBe("on-database");
    });
  });

  describe("clip-audio-window-closed", () => {
    it("attaches pendingSnapshot to the most recent optimistic clip in the session", () => {
      const exec = createExec();
      let state = handleRecordingAction(
        createRecordingState(),
        {
          type: "recording-started",
          outputPath: "/tmp/rec.mkv",
          pauseLength: "short",
        },
        exec
      );

      state = handleRecordingAction(
        state,
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "s1",
        }),
        createExec()
      );

      const sessionId = state.sessions[0]!.id;

      state = handleRecordingAction(
        state,
        {
          type: "clip-audio-window-closed",
          sessionId,
          activeDiagramId: "diagram-1",
          diagramFocused: true,
        },
        createExec()
      );

      const clip = state.items[0] as ClipOptimisticallyAdded;
      expect(clip.pendingSnapshot).toEqual({
        activeDiagramId: "diagram-1",
        diagramFocused: true,
      });
    });
  });
});
