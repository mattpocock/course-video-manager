import { describe, expect, it } from "vitest";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
  selectCompositeLayers,
  selectDiagramKind,
} from "./thumbnail-state-reducer";
import type { ThumbnailDiagramDocument } from "@cvm/core/lib/thumbnail-diagram";
import { ReducerTester } from "@/test-utils/reducer-tester";

/**
 * A Thumbnail's drawing is a Thumbnail Diagram, edited in place (ADR 0060);
 * a Thumbnail saved before that keeps its pasted diagram PNG.
 */

const createState = (
  overrides: Partial<thumbnailStateReducer.State> = {}
): thumbnailStateReducer.State => ({
  ...createInitialThumbnailState(),
  ...overrides,
});

const drawing = (text: string): ThumbnailDiagramDocument => ({
  store: { "shape:a": { id: "shape:a", typeName: "shape", props: { text } } },
  schema: { schemaVersion: 2, sequences: {} },
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

describe("Drawing on a new Thumbnail", () => {
  it("a drawing edit sets pending autosave", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo" })
    );

    const state = tester
      .send({
        type: "drawing-changed",
        document: drawing("Agent"),
        image: "drawing.png",
      })
      .getState();

    expect(state.pendingAutoSave).toBe(true);
  });

  it("a drawing edit before the face is captured saves nothing", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());

    const state = tester
      .send({
        type: "drawing-changed",
        document: drawing("Agent"),
        image: "drawing.png",
      })
      .getState();

    expect(state.pendingAutoSave).toBe(false);
  });

  it("rendering a loaded drawing for the preview is not an edit", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({
        capturedPhoto: "photo",
        editingThumbnailId: "t1",
        thumbnailDiagram: drawing("Agent"),
      })
    );

    const state = tester
      .send({ type: "drawing-rendered", image: "drawing.png" })
      .getState();

    expect(state.pendingAutoSave).toBe(false);
    expect(selectCompositeLayers(state).diagramImage).toBe("drawing.png");
  });

  it("saves the latest drawing as the Thumbnail Diagram", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo" })
    );

    tester
      .send({
        type: "drawing-changed",
        document: drawing("Agent"),
        image: "a.png",
      })
      .send({
        type: "drawing-changed",
        document: drawing("Agent and Tools"),
        image: "b.png",
      });
    save(tester);

    expect(lastSave(tester)).toMatchObject({
      thumbnailDiagram: drawing("Agent and Tools"),
      diagramImage: null,
    });
  });

  it("composites the drawing over the photo, at the frame's origin", () => {
    const state = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo", cutoutPosition: 70 })
    )
      .send({
        type: "drawing-changed",
        document: drawing("Agent"),
        image: "drawing.png",
      })
      .getState();

    // A 1280×720 export at position 50 is drawn at x = 0.
    expect(selectCompositeLayers(state)).toEqual({
      capturedPhoto: "photo",
      diagramImage: "drawing.png",
      diagramPosition: 50,
      cutoutImage: null,
      cutoutPosition: 70,
    });
  });

  it("ignores a pasted image: the diagram is drawn, not pasted", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo" })
    );

    const state = tester
      .send({ type: "diagram-pasted", dataUrl: "pasted.png", position: 10 })
      .getState();

    expect(selectDiagramKind(state)).toBe("drawing");
    expect(state.diagramImage).toBeNull();
  });
});

describe("Reopening a Thumbnail", () => {
  const loaded = (
    overrides: Partial<
      Extract<thumbnailStateReducer.Action, { type: "edit-loaded" }>
    >
  ): thumbnailStateReducer.Action => ({
    type: "edit-loaded",
    thumbnailId: "t1",
    videoId: "v1",
    capturedPhoto: "photo",
    diagramImage: null,
    diagramPosition: 50,
    cutoutImage: "cutout",
    cutoutPosition: 60,
    thumbnailDiagram: null,
    ...overrides,
  });

  it("loads its Thumbnail Diagram back into a fresh editor", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());
    const before = tester.getState().diagramSession;

    const state = tester
      .send(loaded({ thumbnailDiagram: drawing("Agent") }))
      .getState();

    expect(state.thumbnailDiagram).toEqual(drawing("Agent"));
    expect(selectDiagramKind(state)).toBe("drawing");
    expect(state.diagramSession).not.toBe(before);
  });

  it("does not carry one Thumbnail's drawing into the next", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo" })
    );
    tester.send({
      type: "drawing-changed",
      document: drawing("A"),
      image: "a.png",
    });

    const state = tester.send(loaded({ thumbnailId: "t2" })).getState();

    expect(state.thumbnailDiagram).toBeNull();
    expect(selectCompositeLayers(state).diagramImage).toBeNull();
  });

  it("a new Thumbnail starts with an empty drawing in a fresh editor", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo" })
    );
    tester.send({
      type: "drawing-changed",
      document: drawing("A"),
      image: "a.png",
    });
    const before = tester.getState().diagramSession;

    const state = tester
      .send({ type: "new-thumbnail-clicked", videoId: "v1" })
      .getState();

    expect(state.thumbnailDiagram).toBeNull();
    expect(state.diagramSession).not.toBe(before);
  });

  it("an old pasted-PNG Thumbnail opens and saves as before", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());
    tester.send(loaded({ diagramImage: "pasted.png", diagramPosition: 20 }));

    expect(selectDiagramKind(tester.getState())).toBe("pasted");
    tester.send({ type: "diagram-position-changed", value: 30 });
    save(tester);

    expect(lastSave(tester)).toMatchObject({
      diagramImage: "pasted.png",
      diagramPosition: 30,
      thumbnailDiagram: null,
      editingThumbnailId: "t1",
    });
  });

  it("an old Thumbnail's pasted PNG can still be replaced by pasting", () => {
    const tester = new ReducerTester(thumbnailStateReducer, createState());
    tester.send(loaded({ diagramImage: "pasted.png" }));

    const state = tester
      .send({ type: "diagram-pasted", dataUrl: "newer.png", position: 5 })
      .getState();

    expect(state.diagramImage).toBe("newer.png");
  });
});

describe("The face slider", () => {
  it("←/→ nudges the face a small step, Shift a bigger one", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo", cutoutPosition: 50 })
    );

    tester.send({ type: "face-nudged", direction: 1, big: false });
    const small = tester.getState().cutoutPosition - 50;
    tester.send({ type: "face-nudged", direction: -1, big: true });
    const big = 50 + small - tester.getState().cutoutPosition;

    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
  });

  it("a nudge stops at the end of the face's travel", () => {
    const state = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo", cutoutPosition: 99.9 })
    )
      .send({ type: "face-nudged", direction: 1, big: true })
      .getState();

    expect(state.cutoutPosition).toBe(100);
  });

  it("a nudge autosaves like a slide", () => {
    const state = new ReducerTester(
      thumbnailStateReducer,
      createState({ capturedPhoto: "photo", editingThumbnailId: "t1" })
    )
      .send({ type: "face-nudged", direction: -1, big: false })
      .getState();

    expect(state.pendingAutoSave).toBe(true);
  });
});
