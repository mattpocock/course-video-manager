import { describe, expect, it } from "vitest";
import { TLDRAW_DARK_BACKGROUND } from "./canvas-compositor";

describe("canvas-compositor", () => {
  it("exports the TLDraw dark background color", () => {
    expect(TLDRAW_DARK_BACKGROUND).toBe("hsl(240, 5%, 6.5%)");
  });
});
