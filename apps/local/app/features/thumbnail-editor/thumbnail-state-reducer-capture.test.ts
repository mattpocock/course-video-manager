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

describe("Initial State", () => {
  it("should have correct initial state", () => {
    const state = createInitialThumbnailState();

    expect(state.cameraOpen).toBe(false);
    expect(state.capturedPhoto).toBeNull();
    expect(state.diagramImage).toBeNull();
    expect(state.diagramPosition).toBe(50);
    expect(state.cutoutImage).toBeNull();
    expect(state.cutoutPosition).toBe(50);
    expect(state.removingBackground).toBe(false);
    expect(state.backgroundRemovalError).toBeNull();
    expect(state.saving).toBe(false);
    expect(state.deleting).toBeNull();
    expect(state.editingThumbnailId).toBeNull();
    expect(state.loadingEdit).toBeNull();
    expect(state.previewDataUrl).toBeNull();
    expect(state.pendingAutoSave).toBe(false);
  });
});

describe("Camera", () => {
  it("open-camera: should set cameraOpen to true", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());

    const state = tester.send({ type: "open-camera" }).getState();
    expect(state.cameraOpen).toBe(true);
  });

  it("close-camera: should set cameraOpen to false", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ cameraOpen: true })
    );

    const state = tester.send({ type: "close-camera" }).getState();
    expect(state.cameraOpen).toBe(false);
  });

  it("photo-captured: should set capturedPhoto, clear cutout and error, and emit remove-background effect", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        cutoutImage: "old-cutout",
        backgroundRemovalError: "old error",
      })
    );

    const state = tester
      .send({ type: "photo-captured", dataUrl: "photo-data-url" })
      .getState();

    expect(state.capturedPhoto).toBe("photo-data-url");
    expect(state.cutoutImage).toBeNull();
    expect(state.backgroundRemovalError).toBeNull();
    expect(state.removingBackground).toBe(true);
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "remove-background",
      dataUrl: "photo-data-url",
    });
  });

  it("photo-captured: should preserve diagramImage and editingThumbnailId", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        diagramImage: "existing-diagram",
        diagramPosition: 30,
        editingThumbnailId: "thumb-1",
      })
    );

    const state = tester
      .send({ type: "photo-captured", dataUrl: "new-photo" })
      .getState();

    expect(state.capturedPhoto).toBe("new-photo");
    expect(state.diagramImage).toBe("existing-diagram");
    expect(state.diagramPosition).toBe(30);
    expect(state.editingThumbnailId).toBe("thumb-1");
  });
});

describe("Background Removal", () => {
  it("background-removal-succeeded: should set cutoutImage, clear removingBackground, and set pendingAutoSave", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ removingBackground: true })
    );

    const state = tester
      .send({
        type: "background-removal-succeeded",
        dataUrl: "cutout-data-url",
      })
      .getState();

    expect(state.cutoutImage).toBe("cutout-data-url");
    expect(state.removingBackground).toBe(false);
    expect(state.pendingAutoSave).toBe(true);
  });

  it("background-removal-failed: should set error and clear removingBackground", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ removingBackground: true })
    );

    const state = tester
      .send({
        type: "background-removal-failed",
        error: "API error",
      })
      .getState();

    expect(state.backgroundRemovalError).toBe("API error");
    expect(state.removingBackground).toBe(false);
  });

  it("retry-background-removal: should clear error, set removingBackground, and emit effect", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo-data-url",
        backgroundRemovalError: "previous error",
      })
    );

    const state = tester.send({ type: "retry-background-removal" }).getState();

    expect(state.backgroundRemovalError).toBeNull();
    expect(state.removingBackground).toBe(true);
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "remove-background",
      dataUrl: "photo-data-url",
    });
  });

  it("background-removal-failed then retry: should recover and emit new effect", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        removingBackground: true,
      })
    );

    // Fail first
    tester.send({ type: "background-removal-failed", error: "timeout" });
    expect(tester.getState().backgroundRemovalError).toBe("timeout");
    expect(tester.getState().removingBackground).toBe(false);

    // Retry
    tester.resetExec();
    const state = tester.send({ type: "retry-background-removal" }).getState();

    expect(state.backgroundRemovalError).toBeNull();
    expect(state.removingBackground).toBe(true);
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "remove-background",
      dataUrl: "photo",
    });
  });

  it("retry-background-removal: does nothing if no capturedPhoto", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: null })
    );

    const state = tester.send({ type: "retry-background-removal" }).getState();

    expect(state.removingBackground).toBe(false);
    expect(tester.getExec()).not.toHaveBeenCalled();
  });
});

describe("Diagram", () => {
  it("diagram-pasted: should set diagramImage and diagramPosition", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo" })
    );

    const state = tester
      .send({
        type: "diagram-pasted",
        dataUrl: "diagram-data-url",
        position: 42,
      })
      .getState();

    expect(state.diagramImage).toBe("diagram-data-url");
    expect(state.diagramPosition).toBe(42);
  });

  it("diagram-pasted: should set pendingAutoSave when editingThumbnailId is set", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        editingThumbnailId: "thumb-1",
      })
    );

    const state = tester
      .send({
        type: "diagram-pasted",
        dataUrl: "diagram-data-url",
        position: 42,
      })
      .getState();

    expect(state.pendingAutoSave).toBe(true);
  });

  it("diagram-pasted: should not set pendingAutoSave without editingThumbnailId", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo" })
    );

    const state = tester
      .send({
        type: "diagram-pasted",
        dataUrl: "diagram-data-url",
        position: 42,
      })
      .getState();

    expect(state.pendingAutoSave).toBe(false);
  });

  it("diagram-pasted: works without capturedPhoto (diagram-first workflow)", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: null })
    );

    const state = tester
      .send({
        type: "diagram-pasted",
        dataUrl: "diagram-data-url",
        position: 42,
      })
      .getState();

    expect(state.diagramImage).toBe("diagram-data-url");
    expect(state.diagramPosition).toBe(42);
    expect(state.capturedPhoto).toBeNull();
  });

  it("diagram-removed: should set pendingAutoSave when editingThumbnailId is set", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        diagramImage: "diagram",
        editingThumbnailId: "thumb-1",
      })
    );

    const state = tester.send({ type: "diagram-removed" }).getState();

    expect(state.pendingAutoSave).toBe(true);
  });

  it("diagram-removed: should clear diagramImage", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ diagramImage: "diagram-data-url" })
    );

    const state = tester.send({ type: "diagram-removed" }).getState();

    expect(state.diagramImage).toBeNull();
  });

  it("diagram-position-changed: should update diagramPosition", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());

    const state = tester
      .send({ type: "diagram-position-changed", value: 75 })
      .getState();

    expect(state.diagramPosition).toBe(75);
  });

  it("diagram-position-changed: should set pendingAutoSave when editingThumbnailId is set", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ editingThumbnailId: "thumb-1" })
    );

    const state = tester
      .send({ type: "diagram-position-changed", value: 75 })
      .getState();

    expect(state.pendingAutoSave).toBe(true);
  });
});

describe("Cutout", () => {
  it("cutout-removed: should set pendingAutoSave when editingThumbnailId is set", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        cutoutImage: "cutout",
        editingThumbnailId: "thumb-1",
      })
    );

    const state = tester.send({ type: "cutout-removed" }).getState();

    expect(state.pendingAutoSave).toBe(true);
  });

  it("cutout-removed: should clear cutoutImage", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ cutoutImage: "cutout-data-url" })
    );

    const state = tester.send({ type: "cutout-removed" }).getState();

    expect(state.cutoutImage).toBeNull();
  });

  it("cutout-position-changed: should update cutoutPosition", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());

    const state = tester
      .send({ type: "cutout-position-changed", value: 30 })
      .getState();

    expect(state.cutoutPosition).toBe(30);
  });

  it("cutout-position-changed: should set pendingAutoSave when editingThumbnailId is set", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ editingThumbnailId: "thumb-1" })
    );

    const state = tester
      .send({ type: "cutout-position-changed", value: 30 })
      .getState();

    expect(state.pendingAutoSave).toBe(true);
  });
});
