import { describe, expect, it } from "vitest";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
  selectDiagramKind,
} from "./thumbnail-state-reducer";
import type { ThumbnailDiagramDocument } from "@cvm/core/lib/thumbnail-diagram";
import { ReducerTester } from "@/test-utils/reducer-tester";

/**
 * The feature flag OFF (the page's loader reads it): a new Thumbnail is
 * pasted onto as before, and only a Thumbnail that already has a Thumbnail
 * Diagram opens in the editor. Goes when the flag goes.
 */

const flagOff = (
  overrides: Partial<thumbnailStateReducer.State> = {}
): thumbnailStateReducer.State => ({
  ...createInitialThumbnailState(),
  drawsNewThumbnails: false,
  ...overrides,
});

const drawing: ThumbnailDiagramDocument = {
  store: { "shape:a": { id: "shape:a", typeName: "shape", props: {} } },
  schema: { schemaVersion: 2, sequences: {} },
};

const loaded = (thumbnailDiagram: ThumbnailDiagramDocument | null) =>
  ({
    type: "edit-loaded",
    thumbnailId: "t1",
    videoId: "v1",
    capturedPhoto: "photo",
    diagramImage: null,
    diagramPosition: 50,
    cutoutImage: null,
    cutoutPosition: 50,
    thumbnailDiagram,
  }) as const;

describe("with the Thumbnail Diagram flag off", () => {
  it("a new Thumbnail is pasted onto, and takes the paste", () => {
    const tester = new ReducerTester(
      thumbnailStateReducer,
      flagOff({ capturedPhoto: "photo" })
    );
    expect(selectDiagramKind(tester.getState())).toBe("pasted");

    const state = tester
      .send({ type: "diagram-pasted", dataUrl: "diagram.png", position: 50 })
      .getState();
    expect(state.diagramImage).toBe("diagram.png");
  });

  it("New Thumbnail from a drawn one goes back to pasting", () => {
    const state = new ReducerTester(thumbnailStateReducer, flagOff())
      .send(loaded(drawing))
      .send({ type: "new-thumbnail-clicked", videoId: "v1" })
      .getState();
    expect(selectDiagramKind(state)).toBe("pasted");
  });

  it("a Thumbnail that has a Thumbnail Diagram still opens in the editor", () => {
    const state = new ReducerTester(thumbnailStateReducer, flagOff())
      .send(loaded(drawing))
      .getState();
    expect(selectDiagramKind(state)).toBe("drawing");
  });

  it("a Thumbnail with no Thumbnail Diagram opens as before", () => {
    const state = new ReducerTester(thumbnailStateReducer, flagOff())
      .send(loaded(null))
      .getState();
    expect(selectDiagramKind(state)).toBe("pasted");
  });
});

describe("with the flag on", () => {
  it("a new Thumbnail is drawn in the editor", () => {
    expect(selectDiagramKind(createInitialThumbnailState())).toBe("drawing");
  });
});
