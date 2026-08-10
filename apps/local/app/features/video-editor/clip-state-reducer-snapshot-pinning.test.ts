import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOptimisticallyAdded,
  type SessionId,
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

describe("clipStateReducer — diagram snapshot pinning", () => {
  describe("clip-audio-window-closed", () => {
    it("attaches pendingSnapshot to the most recent optimistic clip in the session", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
          silenceLength: "short",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        );

      const sessionId = tester.getState().sessions[0]!.id;

      tester.send({
        type: "clip-audio-window-closed",
        sessionId,
        activeDiagramId: "diagram-1",
        diagramFocused: true,
        ts: 5000,
      });

      const clip = tester.getState().items[0] as ClipOptimisticallyAdded;
      expect(clip.pendingSnapshot).toEqual({
        activeDiagramId: "diagram-1",
        diagramFocused: true,
      });
    });

    it("only attaches to clips that do not yet have pendingSnapshot", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
          silenceLength: "short",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        );
      const sessionId = tester.getState().sessions[0]!.id;
      tester
        .send({
          type: "clip-audio-window-closed",
          sessionId,
          activeDiagramId: "diagram-1",
          diagramFocused: true,
          ts: 5000,
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        )
        .send({
          type: "clip-audio-window-closed",
          sessionId,
          activeDiagramId: "diagram-2",
          diagramFocused: false,
          ts: 6000,
        });

      const items = tester.getState().items as ClipOptimisticallyAdded[];
      expect(items[0]!.pendingSnapshot).toEqual({
        activeDiagramId: "diagram-1",
        diagramFocused: true,
      });
      expect(items[1]!.pendingSnapshot).toEqual({
        activeDiagramId: "diagram-2",
        diagramFocused: false,
      });
    });

    it("is a no-op when no optimistic clip exists in the session", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      tester.send({
        type: "recording-started",
        outputPath: "/tmp/recording.mkv",
        silenceLength: "short",
      });
      const sessionId = tester.getState().sessions[0]!.id;
      const before = tester.getState();

      tester.send({
        type: "clip-audio-window-closed",
        sessionId,
        activeDiagramId: "diagram-1",
        diagramFocused: true,
        ts: 5000,
      });

      expect(tester.getState().items).toEqual(before.items);
    });
  });

  describe("new-database-clips with pendingSnapshot", () => {
    const makeOptimisticClip = (
      sessionId: SessionId,
      overrides: Partial<ClipOptimisticallyAdded> = {}
    ): ClipOptimisticallyAdded =>
      fromPartial({
        type: "optimistically-added",
        frontendId: "fe-1",
        insertionOrder: 1,
        soundDetectionId: "sound-1",
        sessionId,
        pauseType: "none",
        ...overrides,
      });

    it("emits snapshot-for-clip when paired optimistic clip had focused diagram", () => {
      const sessionId = "s-1" as SessionId;
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          sessions: [
            fromPartial({
              id: sessionId,
              outputPath: "/tmp/r.mkv",
              status: "recording",
            }),
          ],
          items: [
            makeOptimisticClip(sessionId, {
              pendingSnapshot: {
                activeDiagramId: "diagram-1",
                diagramFocused: true,
              },
            }),
          ],
        })
      );

      tester.send(
        fromPartial({
          type: "new-database-clips",
          outputPath: "/tmp/r.mkv",
          clips: [
            {
              id: "db-1",
              diagramSnapshotId: null,
              pauseType: "none",
            },
          ],
        })
      );

      const exec = tester.getExec() as any;
      const snapshotCalls = exec.mock.calls.filter(
        (c: any) => c[0]?.type === "snapshot-for-clip"
      );
      expect(snapshotCalls).toHaveLength(1);
      expect(snapshotCalls[0]![0]).toEqual({
        type: "snapshot-for-clip",
        diagramId: "diagram-1",
        clipId: "db-1",
      });
    });

    it("does not emit snapshot-for-clip when diagram was not focused", () => {
      const sessionId = "s-1" as SessionId;
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          sessions: [
            fromPartial({
              id: sessionId,
              outputPath: "/tmp/r.mkv",
              status: "recording",
            }),
          ],
          items: [
            makeOptimisticClip(sessionId, {
              pendingSnapshot: {
                activeDiagramId: "diagram-1",
                diagramFocused: false,
              },
            }),
          ],
        })
      );

      tester.send(
        fromPartial({
          type: "new-database-clips",
          outputPath: "/tmp/r.mkv",
          clips: [{ id: "db-1", diagramSnapshotId: null, pauseType: "none" }],
        })
      );

      const exec = tester.getExec() as any;
      const snapshotCalls = exec.mock.calls.filter(
        (c: any) => c[0]?.type === "snapshot-for-clip"
      );
      expect(snapshotCalls).toHaveLength(0);
    });

    it("does not emit snapshot-for-clip when activeDiagramId is null", () => {
      const sessionId = "s-1" as SessionId;
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          sessions: [
            fromPartial({
              id: sessionId,
              outputPath: "/tmp/r.mkv",
              status: "recording",
            }),
          ],
          items: [
            makeOptimisticClip(sessionId, {
              pendingSnapshot: {
                activeDiagramId: null,
                diagramFocused: true,
              },
            }),
          ],
        })
      );

      tester.send(
        fromPartial({
          type: "new-database-clips",
          outputPath: "/tmp/r.mkv",
          clips: [{ id: "db-1", diagramSnapshotId: null, pauseType: "none" }],
        })
      );

      const exec = tester.getExec() as any;
      const snapshotCalls = exec.mock.calls.filter(
        (c: any) => c[0]?.type === "snapshot-for-clip"
      );
      expect(snapshotCalls).toHaveLength(0);
    });

    it("does not emit snapshot-for-clip when optimistic clip had no pendingSnapshot", () => {
      const sessionId = "s-1" as SessionId;
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          sessions: [
            fromPartial({
              id: sessionId,
              outputPath: "/tmp/r.mkv",
              status: "recording",
            }),
          ],
          items: [makeOptimisticClip(sessionId)],
        })
      );

      tester.send(
        fromPartial({
          type: "new-database-clips",
          outputPath: "/tmp/r.mkv",
          clips: [{ id: "db-1", diagramSnapshotId: null, pauseType: "none" }],
        })
      );

      const exec = tester.getExec() as any;
      const snapshotCalls = exec.mock.calls.filter(
        (c: any) => c[0]?.type === "snapshot-for-clip"
      );
      expect(snapshotCalls).toHaveLength(0);
    });
  });
});
