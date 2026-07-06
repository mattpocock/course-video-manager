import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOptimisticallyAdded,
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
  describe("Recording Sessions", () => {
    describe("recording-started", () => {
      it("Should create a new session with displayNumber 1", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
          silenceLength: "short" as const,
        });

        const state = tester.getState();
        expect(state.sessions).toHaveLength(1);
        expect(state.sessions[0]).toMatchObject({
          displayNumber: 1,
          status: "recording",
        });
        expect(state.sessions[0]!.id).toBeTruthy();
      });

      it("Should increment displayNumber for subsequent sessions", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
            silenceLength: "short" as const,
          })
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
            silenceLength: "short" as const,
          });

        const state = tester.getState();
        expect(state.sessions).toHaveLength(2);
        expect(state.sessions[0]).toMatchObject({ displayNumber: 1 });
        expect(state.sessions[1]).toMatchObject({ displayNumber: 2 });
      });

      it("Should not affect existing items or insertionPoint", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        const stateBefore = tester.getState();
        tester.send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
          silenceLength: "short" as const,
        });
        const stateAfter = tester.getState();

        expect(stateAfter.items).toEqual(stateBefore.items);
        expect(stateAfter.insertionPoint).toEqual(stateBefore.insertionPoint);
        expect(stateAfter.insertionOrder).toEqual(stateBefore.insertionOrder);
      });

      it("Should store the outputPath from the action", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/videos/2026-03-04_10-30-00.mkv",
          silenceLength: "short" as const,
        });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({
          outputPath: "/videos/2026-03-04_10-30-00.mkv",
          status: "recording",
        });
      });

      it("Should preserve outputPath after recording stops", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/videos/session1.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({
          outputPath: "/videos/session1.mkv",
          status: "polling",
        });
      });

      it("Should store different outputPaths for different sessions", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/videos/session1.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" })
          .send({
            type: "recording-started",
            outputPath: "/videos/session2.mkv",
            silenceLength: "short" as const,
          });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({
          outputPath: "/videos/session1.mkv",
          status: "polling",
        });
        expect(state.sessions[1]).toMatchObject({
          outputPath: "/videos/session2.mkv",
          status: "recording",
        });
      });

      it("Should fire start-session-polling effect with sessionId and outputPath", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/videos/recording.mkv",
          silenceLength: "short" as const,
        });

        const sessionId = tester.getState().sessions[0]!.id;

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "start-session-polling",
          sessionId,
          outputPath: "/videos/recording.mkv",
          silenceLength: "short",
        });
      });

      it("Should fire separate start-session-polling effects for each session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/videos/session1.mkv",
          silenceLength: "short" as const,
        });
        const session1Id = tester.getState().sessions[0]!.id;

        tester.resetExec().send({ type: "recording-stopped" });

        tester.resetExec().send({
          type: "recording-started",
          outputPath: "/videos/session2.mkv",
          silenceLength: "short" as const,
        });
        const session2Id = tester.getState().sessions[1]!.id;

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "start-session-polling",
          sessionId: session2Id,
          outputPath: "/videos/session2.mkv",
          silenceLength: "short",
        });

        expect(session1Id).not.toEqual(session2Id);
      });

      it("Should fire scroll-to-insertion-point effect", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/videos/recording.mkv",
          silenceLength: "short" as const,
        });

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "scroll-to-insertion-point",
        });
      });
    });

    describe("recording-stopped", () => {
      it("Should mark the active session as no longer recording", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" });

        const state = tester.getState();
        expect(state.sessions).toHaveLength(1);
        expect(state.sessions[0]).toMatchObject({
          displayNumber: 1,
          status: "polling",
        });
      });

      it("Should only mark the currently recording session as stopped", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        // Start first session, stop it, start second session
        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" })
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
            silenceLength: "short" as const,
          });

        const stateBefore = tester.getState();
        expect(stateBefore.sessions[0]).toMatchObject({ status: "polling" });
        expect(stateBefore.sessions[1]).toMatchObject({ status: "recording" });

        // Stop second session
        tester.send({ type: "recording-stopped" });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "polling" });
        expect(state.sessions[1]).toMatchObject({ status: "polling" });
      });

      it("Should fire start-session-timeout effect with the session id", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
          silenceLength: "short" as const,
        });
        const sessionId = tester.getState().sessions[0]!.id;

        tester.resetExec().send({ type: "recording-stopped" });

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "start-session-timeout",
          sessionId,
        });
      });

      it("Should no-op if no session is currently recording", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        const stateBefore = tester.getState();
        tester.send({ type: "recording-stopped" });
        const stateAfter = tester.getState();

        expect(stateAfter).toEqual(stateBefore);
        expect(tester.getExec()).not.toHaveBeenCalled();
      });
    });

    describe("session-polling-complete", () => {
      it("Should atomically set session status to done and mark orphans", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

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
          )
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        tester.send({ type: "session-polling-complete", sessionId });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "done" });
        const clip1 = state.items[0] as ClipOptimisticallyAdded;
        const clip2 = state.items[1] as ClipOptimisticallyAdded;
        expect(clip1.isOrphaned).toBe(true);
        expect(clip2.isOrphaned).toBe(true);
      });

      it("Should only affect the targeted session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        // Session 1 with a clip
        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording1.mkv",
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

        // Session 2 with a clip
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
          )
          .send({ type: "recording-stopped" });

        // Complete only session 1
        tester.send({
          type: "session-polling-complete",
          sessionId: session1Id,
        });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "done" });
        expect(state.sessions[1]).toMatchObject({ status: "polling" });

        const clip1 = state.items[0] as ClipOptimisticallyAdded;
        const clip2 = state.items[1] as ClipOptimisticallyAdded;
        expect(clip1.isOrphaned).toBe(true);
        expect(clip2.isOrphaned).toBeUndefined();
      });

      it("Should not mark archived clips as orphaned", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

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
          )
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        // Archive the first clip
        const clip1Id = tester.getState().items[0]!.frontendId;
        tester.send({ type: "clips-deleted", clipIds: [clip1Id] });

        tester.send({ type: "session-polling-complete", sessionId });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "done" });

        const archivedClip = state.items.find(
          (c) => c.frontendId === clip1Id
        ) as ClipOptimisticallyAdded;
        expect(archivedClip.shouldArchive).toBe(true);
        expect(archivedClip.isOrphaned).toBeUndefined();

        const otherClip = state.items.find(
          (c) => c.frontendId !== clip1Id
        ) as ClipOptimisticallyAdded;
        expect(otherClip.isOrphaned).toBe(true);
      });

      it("Should no-op if session is already done", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

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

        tester.send({ type: "session-polling-complete", sessionId });
        const stateAfterFirst = tester.getState();

        tester.send({ type: "session-polling-complete", sessionId });
        const stateAfterSecond = tester.getState();

        expect(stateAfterSecond).toBe(stateAfterFirst);
      });

      it("Should emit revalidate-loader when all sessions become done", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        tester.resetExec();
        tester.send({ type: "session-polling-complete", sessionId });

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "revalidate-loader",
        });
      });

      it("Should emit revalidate-loader only when the last session becomes done", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        // Session 1
        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording1.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" });

        const session1Id = tester.getState().sessions[0]!.id;

        // Session 2
        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording2.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" });

        const session2Id = tester.getState().sessions[1]!.id;

        // Complete session 1 — not all done yet
        tester.resetExec();
        tester.send({
          type: "session-polling-complete",
          sessionId: session1Id,
        });

        expect(tester.getExec()).not.toHaveBeenCalledWith({
          type: "revalidate-loader",
        });

        // Complete session 2 — now all done
        tester.resetExec();
        tester.send({
          type: "session-polling-complete",
          sessionId: session2Id,
        });

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "revalidate-loader",
        });
      });

      it("Should not emit revalidate-loader when session is already done", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        tester.send({ type: "session-polling-complete", sessionId });

        // Second dispatch — should no-op, no revalidate
        tester.resetExec();
        tester.send({ type: "session-polling-complete", sessionId });

        expect(tester.getExec()).not.toHaveBeenCalledWith({
          type: "revalidate-loader",
        });
      });

      it("Should set status to done even if no unresolved clips exist", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
            silenceLength: "short" as const,
          })
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        tester.send({ type: "session-polling-complete", sessionId });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "done" });
      });
    });
  });
});
