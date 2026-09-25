import { describe, expect, it } from "vitest";
import { renderInRouter } from "@/test-utils/render-in-router";
import { AnimaticEmptyState } from "./animatic-empty-state";

describe("AnimaticEmptyState", () => {
  it("names the command that authors Clip Mockups", () => {
    const html = renderInRouter(<AnimaticEmptyState videoId="v1" />);

    // The Animatic is reachable from a Video that has nothing to watch, so a
    // blank frame would read as a broken page. The way out is the command.
    expect(html).toContain("cvm clip-mockup add");
    expect(html).toContain('href="/videos/v1/edit"');
  });
});
