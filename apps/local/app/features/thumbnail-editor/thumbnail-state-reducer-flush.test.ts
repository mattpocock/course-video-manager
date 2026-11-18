import { describe, expect, it } from "vitest";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
  selectPendingSave,
} from "./thumbnail-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";

/**
 * An edit waits 500 ms for its autosave. Leaving the Thumbnail before then
 * (opening another, New, leaving the page) saves it at once, the sources of
 * its inserts included: they live nowhere else (ADR 0060: not lossy).
 */

const component = {
  kind: "diagram-component",
  diagramComponentId: "c1",
} as const;

/** t1 open, an insert recorded, its autosave not yet fired. */
const pendingOnT1 = (
  overrides: Partial<thumbnailStateReducer.State> = {}
): thumbnailStateReducer.State => ({
  ...createInitialThumbnailState(),
  capturedPhoto: "photo",
  previewDataUrl: "composite",
  editingThumbnailId: "t1",
  diagramSources: [component],
  pendingAutoSave: true,
  ...overrides,
});

const saves = (tester: ReducerTester<any, any, any>) =>
  (tester.getExec() as any).mock.calls
    .map(([effect]: [thumbnailStateReducer.Effect]) => effect)
    .filter((e: thumbnailStateReducer.Effect) => e.type === "save-thumbnail");

const loaded = (thumbnailId: string) =>
  ({
    type: "edit-loaded",
    thumbnailId,
    videoId: "v1",
    capturedPhoto: "photo-2",
    diagramImage: null,
    diagramPosition: 50,
    cutoutImage: null,
    cutoutPosition: 50,
    thumbnailDiagram: null,
  }) as const;

describe("Leaving a Thumbnail with an unsaved edit", () => {
  it("saves it, sources included, before opening another Thumbnail", () => {
    const tester = new ReducerTester(thumbnailStateReducer, pendingOnT1());

    tester.send({ type: "edit-requested", thumbnailId: "t2", videoId: "v1" });

    expect(saves(tester)).toEqual([
      expect.objectContaining({
        videoId: "v1",
        editingThumbnailId: "t1",
        compositeDataUrl: "composite",
        diagramSources: [component],
      }),
    ]);
    expect(tester.getState().pendingAutoSave).toBe(false);
  });

  it("saves an edit made while the next Thumbnail loaded, to the one left", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      pendingOnT1({ pendingAutoSave: false })
    );

    tester
      .send({ type: "edit-requested", thumbnailId: "t2", videoId: "v1" })
      .send({ type: "insert-source-recorded", source: component })
      .send(loaded("t2"));

    expect(saves(tester)).toEqual([
      expect.objectContaining({
        editingThumbnailId: "t1",
        diagramSources: [component],
      }),
    ]);
    expect(tester.getState().editingThumbnailId).toBe("t2");
    expect(tester.getState().diagramSources).toEqual([]);
  });

  it("saves it before New", () => {
    const tester = new ReducerTester(thumbnailStateReducer, pendingOnT1());

    tester.send({ type: "new-thumbnail-clicked", videoId: "v1" });

    expect(saves(tester)).toEqual([
      expect.objectContaining({
        editingThumbnailId: "t1",
        diagramSources: [component],
      }),
    ]);
  });

  it("saves it when the page is hidden", () => {
    const tester = new ReducerTester(thumbnailStateReducer, pendingOnT1());

    tester.send({ type: "page-hidden", videoId: "v1" });

    expect(saves(tester)).toEqual([
      expect.objectContaining({ editingThumbnailId: "t1" }),
    ]);
    expect(tester.getState().pendingAutoSave).toBe(false);
  });

  it("creates a Thumbnail not yet saved", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      pendingOnT1({ editingThumbnailId: null })
    );

    tester.send({ type: "new-thumbnail-clicked", videoId: "v1" });

    expect(saves(tester)).toEqual([
      expect.objectContaining({ editingThumbnailId: null, videoId: "v1" }),
    ]);
  });

  it("saves nothing when nothing is waiting", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      pendingOnT1({ pendingAutoSave: false })
    );

    tester
      .send({ type: "edit-requested", thumbnailId: "t2", videoId: "v1" })
      .send({ type: "page-hidden", videoId: "v1" });

    expect(saves(tester)).toEqual([]);
  });

  it("doesn't create a second copy while the first create is still out", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      pendingOnT1({ editingThumbnailId: null, saving: true })
    );

    tester.send({ type: "new-thumbnail-clicked", videoId: "v1" });

    expect(saves(tester)).toEqual([]);
  });

  it("keeps the newly opened Thumbnail open when the left one's save lands", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      pendingOnT1({ editingThumbnailId: null })
    );

    tester.send({ type: "edit-requested", thumbnailId: "t2", videoId: "v1" });
    const [flush] = saves(tester);
    tester.send(loaded("t2")).send({
      type: "save-succeeded",
      thumbnailId: "created",
      diagramSession: flush.diagramSession,
    });

    expect(tester.getState().editingThumbnailId).toBe("t2");
    expect(tester.getState().saving).toBe(false);
  });
});

describe("selectPendingSave (leaving the page, the reducer gone)", () => {
  it("is the save the autosave would have made", () => {
    expect(selectPendingSave(pendingOnT1(), "v1")).toEqual(
      expect.objectContaining({
        type: "save-thumbnail",
        videoId: "v1",
        editingThumbnailId: "t1",
        diagramSources: [component],
      })
    );
  });

  it("is null with nothing waiting, or no face to save", () => {
    expect(
      selectPendingSave(pendingOnT1({ pendingAutoSave: false }), "v1")
    ).toBeNull();
    expect(
      selectPendingSave(pendingOnT1({ capturedPhoto: null }), "v1")
    ).toBeNull();
  });
});
