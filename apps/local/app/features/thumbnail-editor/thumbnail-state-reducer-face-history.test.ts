import { describe, expect, it } from "vitest";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
} from "./thumbnail-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";

/**
 * One undo history for the face and the Thumbnail Diagram: the face rides in
 * the editor document's meta, so the editor's undo puts it back. The reducer
 * says which face changes are undo steps (`record-face`), and takes back
 * whatever face the editor's undo or redo restores (`face-restored`).
 */

type Tester = ReducerTester<
  thumbnailStateReducer.State,
  thumbnailStateReducer.Action,
  thumbnailStateReducer.Effect
>;

const editing = (
  overrides: Partial<thumbnailStateReducer.State> = {}
): Tester =>
  new ReducerTester(thumbnailStateReducer, {
    ...createInitialThumbnailState(),
    capturedPhoto: "photo",
    cutoutImage: "cutout",
    cutoutPosition: 50,
    editingThumbnailId: "t1",
    ...overrides,
  });

const recorded = (tester: Tester) =>
  tester.getEffects().filter((e) => e.type === "record-face");

const lastSave = (tester: Tester) => {
  tester.send({
    type: "save-requested",
    videoId: "v1",
    compositeDataUrl: "composite",
  });
  return tester
    .getEffects()
    .filter((e) => e.type === "save-thumbnail")
    .at(-1);
};

describe("A face move", () => {
  it("is recorded in the editor's history as an undo step of its own", () => {
    const tester = editing().send({
      type: "cutout-position-changed",
      value: 70,
    });

    expect(recorded(tester)).toEqual([
      {
        type: "record-face",
        face: { photo: "photo", cutout: "cutout", horizontalPosition: 70 },
        history: "new-step",
      },
    ]);
  });

  it("one drag of the slider is one undo step", () => {
    const tester = editing()
      .send({ type: "face-slide-started" })
      .send({ type: "cutout-position-changed", value: 55 })
      .send({ type: "cutout-position-changed", value: 60 })
      .send({ type: "cutout-position-changed", value: 65 })
      .send({ type: "face-slide-ended" })
      .send({ type: "cutout-position-changed", value: 66 });

    expect(recorded(tester).map((e) => e.history)).toEqual([
      "new-step",
      "same-step",
      "same-step",
      "new-step",
    ]);
  });

  it("undoing it puts the face back, and the autosave saves it there", () => {
    const tester = editing()
      .send({ type: "cutout-position-changed", value: 70 })
      .send({ type: "save-succeeded", thumbnailId: "t1" })
      .send({
        type: "face-restored",
        face: { photo: "photo", cutout: "cutout", horizontalPosition: 50 },
      });

    expect(tester.getState().cutoutPosition).toBe(50);
    expect(tester.getState().pendingAutoSave).toBe(true);
    expect(lastSave(tester)).toMatchObject({ cutoutPosition: 50 });
  });

  it("an undo restores the face without recording it again", () => {
    const tester = editing().send({
      type: "face-restored",
      face: { photo: "photo", cutout: "cutout", horizontalPosition: 30 },
    });

    expect(recorded(tester)).toEqual([]);
  });
});

describe("A nudge", () => {
  it("is an undo step of its own, and undoing it puts the face back", () => {
    const tester = editing()
      .send({ type: "face-nudged", direction: 1, big: true })
      .send({ type: "face-nudged", direction: 1, big: true });
    const [first, second] = recorded(tester);

    expect([first?.history, second?.history]).toEqual(["new-step", "new-step"]);

    tester.send({ type: "face-restored", face: first!.face });
    expect(tester.getState().cutoutPosition).toBe(
      first!.face.horizontalPosition
    );
  });
});

describe("A retake", () => {
  it("is one undo step: the new photo and its new Cutout together", () => {
    const tester = editing()
      .send({ type: "photo-captured", dataUrl: "new-photo" })
      .send({ type: "background-removal-succeeded", dataUrl: "new-cutout" });

    expect(recorded(tester)).toEqual([
      {
        type: "record-face",
        face: {
          photo: "new-photo",
          cutout: "new-cutout",
          horizontalPosition: 50,
        },
        history: "new-step",
      },
    ]);
  });

  it("keeps the face where it was", () => {
    const tester = editing({ cutoutPosition: 80 })
      .send({ type: "photo-captured", dataUrl: "new-photo" })
      .send({ type: "background-removal-succeeded", dataUrl: "new-cutout" });

    expect(recorded(tester)[0]?.face.horizontalPosition).toBe(80);
  });

  it("whose background removal fails is still an undo step, without a Cutout", () => {
    const tester = editing()
      .send({ type: "photo-captured", dataUrl: "new-photo" })
      .send({ type: "background-removal-failed", error: "nope" });

    expect(recorded(tester)).toEqual([
      {
        type: "record-face",
        face: { photo: "new-photo", cutout: null, horizontalPosition: 50 },
        history: "new-step",
      },
    ]);
  });

  it("undone restores the previous photo and Cutout, in what is saved too", () => {
    const tester = editing()
      .send({ type: "photo-captured", dataUrl: "new-photo" })
      .send({ type: "background-removal-succeeded", dataUrl: "new-cutout" })
      .send({ type: "save-succeeded", thumbnailId: "t1" })
      .send({
        type: "face-restored",
        face: { photo: "photo", cutout: "cutout", horizontalPosition: 50 },
      });

    expect(lastSave(tester)).toMatchObject({
      capturedPhoto: "photo",
      cutoutImage: "cutout",
      cutoutPosition: 50,
    });
  });

  it("the first capture's Cutout is no undo step: there is nothing to go back to", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createInitialThumbnailState()
    )
      .send({ type: "photo-captured", dataUrl: "photo" })
      .send({ type: "background-removal-succeeded", dataUrl: "cutout" });

    expect(recorded(tester).map((e) => e.history)).toEqual(["silent"]);
  });
});

describe("Saving splits the face from the drawing", () => {
  const withFaceInMeta = {
    store: {
      "document:document": {
        id: "document:document",
        typeName: "document",
        name: "",
        gridSize: 10,
        meta: {
          thumbnailDarkPanel: false,
          thumbnailFace: {
            photo: "photo",
            cutout: "cutout",
            horizontalPosition: 70,
          },
        },
      },
      "shape:a": { id: "shape:a", typeName: "shape", props: { text: "Agent" } },
    },
    schema: { schemaVersion: 2, sequences: {} },
  };

  it("the face goes to the Thumbnail's layers; the Thumbnail Diagram is the drawing alone, its dark panel setting kept", () => {
    const tester = editing({ cutoutPosition: 70 }).send({
      type: "drawing-changed",
      document: withFaceInMeta,
      image: "drawing.png",
    });

    const saved = lastSave(tester);
    expect(saved).toMatchObject({
      capturedPhoto: "photo",
      cutoutImage: "cutout",
      cutoutPosition: 70,
      thumbnailDiagram: {
        store: {
          "document:document": { meta: { thumbnailDarkPanel: false } },
          "shape:a": { props: { text: "Agent" } },
        },
      },
    });
    expect(JSON.stringify(saved)).not.toContain("thumbnailFace");
  });
});
