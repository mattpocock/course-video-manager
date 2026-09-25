import { describe, it, expect } from "vitest";
import {
  rebaseLineagePath,
  rebaseLineagePathsDeep,
} from "./thumbnail-path-rebase.js";

const SOURCE = "source-lineage";
const COPY = "copy-lineage";

describe("rebaseLineagePath", () => {
  it("points a duplicated Thumbnail's composite at the copy's own directory", () => {
    expect(
      rebaseLineagePath(
        `/store/video-files/${SOURCE}/thumbnail-abc.png`,
        SOURCE,
        COPY
      )
    ).toBe(`/store/video-files/${COPY}/thumbnail-abc.png`);
  });

  it("leaves a path that does not name the source's lineage alone", () => {
    // Not a path this code wrote, so there is nowhere to send it. An alias a
    // human can still see beats a path that points nowhere.
    const foreign = "/some/other/place/thumbnail.png";
    expect(rebaseLineagePath(foreign, SOURCE, COPY)).toBe(foreign);
  });

  it("does not rewrite the lineage id where it is not a path segment", () => {
    const named = `/store/video-files/other/${SOURCE}.png`;
    expect(rebaseLineagePath(named, SOURCE, COPY)).toBe(named);
  });
});

describe("rebaseLineagePathsDeep", () => {
  it("rewrites every layer's path, whatever the layer shape", () => {
    const layers = {
      backgroundPhoto: {
        filePath: `/store/${SOURCE}/thumbnail-a-bg.png`,
        horizontalPosition: 50,
      },
      diagram: {
        filePath: `/store/${SOURCE}/thumbnail-a-diagram.png`,
        horizontalPosition: 20,
      },
      cutout: null,
    };

    expect(rebaseLineagePathsDeep(layers, SOURCE, COPY)).toEqual({
      backgroundPhoto: {
        filePath: `/store/${COPY}/thumbnail-a-bg.png`,
        horizontalPosition: 50,
      },
      diagram: {
        filePath: `/store/${COPY}/thumbnail-a-diagram.png`,
        horizontalPosition: 20,
      },
      cutout: null,
    });
  });

  it("reaches a path nested in an array, so a new layer shape cannot hide one", () => {
    expect(
      rebaseLineagePathsDeep(
        { extras: [{ filePath: `/store/${SOURCE}/x.png` }] },
        SOURCE,
        COPY
      )
    ).toEqual({ extras: [{ filePath: `/store/${COPY}/x.png` }] });
  });
});
