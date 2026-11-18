import { describe, expect, it } from "vitest";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
} from "./thumbnail-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";

/**
 * Every insert into a Thumbnail Diagram records its source (ADR 0060). The
 * page holds the sources of its inserts and sends them with each save; the
 * server adds them to the ones already recorded.
 */

const createState = (
  overrides: Partial<thumbnailStateReducer.State> = {}
): thumbnailStateReducer.State => ({
  ...createInitialThumbnailState(),
  ...overrides,
});

const lastSave = (tester: ReducerTester<any, any, any>) =>
  (tester.getExec() as any).mock.calls
    .map(([effect]: [thumbnailStateReducer.Effect]) => effect)
    .filter((e: thumbnailStateReducer.Effect) => e.type === "save-thumbnail")
    .at(-1);

const save = (tester: ReducerTester<any, any, any>) =>
  tester.send({
    type: "save-requested",
    videoId: "v1",
    compositeDataUrl: "composite",
  });

const component = {
  kind: "diagram-component",
  diagramComponentId: "c1",
} as const;
const snapshot = {
  kind: "diagram-snapshot",
  diagramSnapshotId: "s1",
} as const;

describe("Recording where an insert came from", () => {
  it("goes out with the next save, each source once", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo", editingThumbnailId: "t1" })
    );

    tester
      .send({ type: "insert-source-recorded", source: component })
      .send({ type: "insert-source-recorded", source: snapshot })
      .send({ type: "insert-source-recorded", source: component });
    save(tester);

    expect(lastSave(tester).diagramSources).toEqual([component, snapshot]);
  });

  it("sets pending autosave once a face exists", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo" })
    );

    const state = tester
      .send({ type: "insert-source-recorded", source: component })
      .getState();

    expect(state.pendingAutoSave).toBe(true);
  });

  it("before the face is captured, waits for the Thumbnail's first save", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());

    tester.send({ type: "insert-source-recorded", source: component });
    expect(tester.getState().pendingAutoSave).toBe(false);

    tester
      .send({ type: "photo-captured", dataUrl: "photo" })
      .send({ type: "background-removal-succeeded", dataUrl: "cutout" });
    save(tester);

    expect(lastSave(tester).diagramSources).toEqual([component]);
  });

  it("never goes out with another Thumbnail's save", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo", editingThumbnailId: "t1" })
    );

    tester.send({ type: "insert-source-recorded", source: component }).send({
      type: "edit-loaded",
      thumbnailId: "t2",
      videoId: "v1",
      capturedPhoto: "photo-2",
      diagramImage: null,
      diagramPosition: 50,
      cutoutImage: null,
      cutoutPosition: 50,
      thumbnailDiagram: null,
    });
    save(tester);

    expect(lastSave(tester).editingThumbnailId).toBe("t2");
    expect(lastSave(tester).diagramSources).toEqual([]);
  });
});
