import { describe, expect, it } from "vitest";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
} from "./thumbnail-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";

const createState = (
  overrides: Partial<thumbnailStateReducer.State> = {}
): thumbnailStateReducer.State => ({
  ...createInitialThumbnailState(),
  ...overrides,
});

describe("Save", () => {
  it("save-requested: should set saving to true, clear pendingAutoSave, and emit save effect", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        diagramImage: "diagram",
        diagramPosition: 60,
        cutoutImage: "cutout",
        cutoutPosition: 40,
        pendingAutoSave: true,
      })
    );

    const state = tester
      .send({
        type: "save-requested",
        videoId: "v1",
        compositeDataUrl: "composite",
      })
      .getState();

    expect(state.saving).toBe(true);
    expect(state.pendingAutoSave).toBe(false);
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "save-thumbnail",
      videoId: "v1",
      compositeDataUrl: "composite",
      capturedPhoto: "photo",
      diagramImage: "diagram",
      diagramPosition: 60,
      cutoutImage: "cutout",
      cutoutPosition: 40,
      editingThumbnailId: null,
    });
  });

  it("save-requested: does nothing if no capturedPhoto", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: null })
    );

    const state = tester
      .send({
        type: "save-requested",
        videoId: "v1",
        compositeDataUrl: "composite",
      })
      .getState();

    expect(state.saving).toBe(false);
    expect(tester.getExec()).not.toHaveBeenCalled();
  });

  it("save-requested: should pass editingThumbnailId when editing", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        editingThumbnailId: "thumb-1",
      })
    );

    tester.send({
      type: "save-requested",
      videoId: "v1",
      compositeDataUrl: "composite",
    });

    expect(tester.getExec()).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "save-thumbnail",
        editingThumbnailId: "thumb-1",
      })
    );
  });

  it("save-succeeded: should keep editor open and set editingThumbnailId", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        saving: true,
        capturedPhoto: "photo",
        diagramImage: "diagram",
        diagramPosition: 60,
        cutoutImage: "cutout",
        cutoutPosition: 40,
        editingThumbnailId: null,
      })
    );

    const state = tester
      .send({ type: "save-succeeded", thumbnailId: "new-thumb" })
      .getState();

    expect(state.saving).toBe(false);
    expect(state.editingThumbnailId).toBe("new-thumb");
    // Editor state preserved (not cleared)
    expect(state.capturedPhoto).toBe("photo");
    expect(state.diagramImage).toBe("diagram");
    expect(state.diagramPosition).toBe(60);
    expect(state.cutoutImage).toBe("cutout");
    expect(state.cutoutPosition).toBe(40);
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "revalidate",
    });
  });

  it("save-succeeded: should preserve previewDataUrl", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        saving: true,
        capturedPhoto: "photo",
        previewDataUrl: "preview",
      })
    );

    const state = tester
      .send({ type: "save-succeeded", thumbnailId: "thumb-1" })
      .getState();

    expect(state.previewDataUrl).toBe("preview");
  });

  it("save-failed: should preserve editor state", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        saving: true,
        capturedPhoto: "photo",
        diagramImage: "diagram",
        diagramPosition: 60,
        cutoutImage: "cutout",
        cutoutPosition: 40,
        editingThumbnailId: "thumb-1",
      })
    );

    const state = tester.send({ type: "save-failed" }).getState();

    expect(state.saving).toBe(false);
    expect(state.capturedPhoto).toBe("photo");
    expect(state.diagramImage).toBe("diagram");
    expect(state.diagramPosition).toBe(60);
    expect(state.cutoutImage).toBe("cutout");
    expect(state.cutoutPosition).toBe(40);
    expect(state.editingThumbnailId).toBe("thumb-1");
  });

  it("save-failed: should set saving to false", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ saving: true })
    );

    const state = tester.send({ type: "save-failed" }).getState();

    expect(state.saving).toBe(false);
  });
});

describe("Delete", () => {
  it("delete-requested: should set deleting to thumbnailId and emit effect", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());

    const state = tester
      .send({ type: "delete-requested", thumbnailId: "thumb-1" })
      .getState();

    expect(state.deleting).toBe("thumb-1");
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "delete-thumbnail",
      thumbnailId: "thumb-1",
    });
  });

  it("delete-succeeded: should clear deleting and emit revalidate", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ deleting: "thumb-1" })
    );

    const state = tester.send({ type: "delete-succeeded" }).getState();

    expect(state.deleting).toBeNull();
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "revalidate",
    });
  });

  it("delete-failed: should clear deleting", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ deleting: "thumb-1" })
    );

    const state = tester.send({ type: "delete-failed" }).getState();

    expect(state.deleting).toBeNull();
  });
});

describe("Edit", () => {
  it("edit-requested: should set loadingEdit to thumbnailId and emit effect", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());

    const state = tester
      .send({ type: "edit-requested", thumbnailId: "thumb-1" })
      .getState();

    expect(state.loadingEdit).toBe("thumb-1");
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "load-thumbnail",
      thumbnailId: "thumb-1",
    });
  });

  it("edit-loaded: should populate editor with loaded data", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ loadingEdit: "thumb-1" })
    );

    const state = tester
      .send({
        type: "edit-loaded",
        thumbnailId: "thumb-1",
        capturedPhoto: "bg-photo",
        diagramImage: "diagram",
        diagramPosition: 30,
        cutoutImage: "cutout",
        cutoutPosition: 70,
      })
      .getState();

    expect(state.loadingEdit).toBeNull();
    expect(state.editingThumbnailId).toBe("thumb-1");
    expect(state.capturedPhoto).toBe("bg-photo");
    expect(state.diagramImage).toBe("diagram");
    expect(state.diagramPosition).toBe(30);
    expect(state.cutoutImage).toBe("cutout");
    expect(state.cutoutPosition).toBe(70);
    expect(state.backgroundRemovalError).toBeNull();
  });

  it("edit-loaded: should handle thumbnail with no diagram or cutout", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ loadingEdit: "thumb-2" })
    );

    const state = tester
      .send({
        type: "edit-loaded",
        thumbnailId: "thumb-2",
        capturedPhoto: "bg-only",
        diagramImage: null,
        diagramPosition: 50,
        cutoutImage: null,
        cutoutPosition: 50,
      })
      .getState();

    expect(state.editingThumbnailId).toBe("thumb-2");
    expect(state.capturedPhoto).toBe("bg-only");
    expect(state.diagramImage).toBeNull();
    expect(state.cutoutImage).toBeNull();
  });

  it("edit-failed: should clear loadingEdit", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ loadingEdit: "thumb-1" })
    );

    const state = tester.send({ type: "edit-failed" }).getState();

    expect(state.loadingEdit).toBeNull();
  });
});

describe("New Thumbnail", () => {
  it("new-thumbnail-clicked: should clear all editor state", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        diagramImage: "diagram",
        diagramPosition: 60,
        cutoutImage: "cutout",
        cutoutPosition: 40,
        editingThumbnailId: "thumb-1",
        backgroundRemovalError: "err",
      })
    );

    const state = tester.send({ type: "new-thumbnail-clicked" }).getState();

    expect(state.capturedPhoto).toBeNull();
    expect(state.diagramImage).toBeNull();
    expect(state.diagramPosition).toBe(50);
    expect(state.cutoutImage).toBeNull();
    expect(state.cutoutPosition).toBe(50);
    expect(state.editingThumbnailId).toBeNull();
    expect(state.backgroundRemovalError).toBeNull();
  });

  it("new-thumbnail-clicked: should not affect transient operation states", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        cameraOpen: true,
        removingBackground: true,
        saving: true,
        deleting: "thumb-2",
      })
    );

    const state = tester.send({ type: "new-thumbnail-clicked" }).getState();

    // Editor state cleared
    expect(state.capturedPhoto).toBeNull();
    // Transient states preserved (they have their own lifecycle)
    expect(state.cameraOpen).toBe(true);
    expect(state.removingBackground).toBe(true);
    expect(state.saving).toBe(true);
    expect(state.deleting).toBe("thumb-2");
  });

  it("new-thumbnail-clicked: should clear pendingAutoSave", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        pendingAutoSave: true,
      })
    );

    const state = tester.send({ type: "new-thumbnail-clicked" }).getState();

    expect(state.pendingAutoSave).toBe(false);
  });

  it("new-thumbnail-clicked: should clear previewDataUrl", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        previewDataUrl: "old-preview",
      })
    );

    const state = tester.send({ type: "new-thumbnail-clicked" }).getState();

    expect(state.previewDataUrl).toBeNull();
  });
});

describe("Preview", () => {
  it("preview-updated: should set previewDataUrl", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());

    const state = tester
      .send({ type: "preview-updated", dataUrl: "preview-url" })
      .getState();

    expect(state.previewDataUrl).toBe("preview-url");
  });

  it("preview-updated: should handle null (cleared preview)", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ previewDataUrl: "old-preview" })
    );

    const state = tester
      .send({ type: "preview-updated", dataUrl: null })
      .getState();

    expect(state.previewDataUrl).toBeNull();
  });
});
