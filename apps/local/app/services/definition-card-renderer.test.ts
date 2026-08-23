import { describe, expect, it } from "vitest";
import { definitionCardRenderProps } from "@/services/definition-card-renderer";
import {
  DEFINITION_CARD_FPS,
  DEFINITION_CARD_FRAME,
} from "@/services/overlay-render-cache";

const content = {
  title: "Hydration",
  description: "Attaching React to server-rendered HTML.",
  durationInSeconds: 4.25,
};

describe("definitionCardRenderProps", () => {
  it("renders the card as its own clip, exactly as long as the card", () => {
    const props = definitionCardRenderProps(content);

    expect(props.definitionCards).toHaveLength(1);
    expect(props.definitionCards[0]!.durationInFrames).toBe(
      props.durationInFrames
    );
  });

  it("covers the whole of a duration that lands between two frames", () => {
    const props = definitionCardRenderProps({
      ...content,
      durationInSeconds: 4.25,
    });

    expect(props.durationInFrames).toBe(Math.ceil(4.25 * DEFINITION_CARD_FPS));
    expect(props.durationInFrames / DEFINITION_CARD_FPS).toBeGreaterThanOrEqual(
      4.25
    );
  });

  it("renders at the landscape export frame", () => {
    const props = definitionCardRenderProps(content);

    expect({ width: props.width, height: props.height }).toEqual(
      DEFINITION_CARD_FRAME
    );
  });

  it("carries the card's own words", () => {
    const props = definitionCardRenderProps(content);

    expect(props.definitionCards[0]).toMatchObject({
      title: content.title,
      description: content.description,
    });
  });
});
