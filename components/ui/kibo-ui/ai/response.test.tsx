import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AIResponse } from "./response";

const DOC = `# Title

Intro paragraph.

<choosescreenshot clipindex="1" alt="the editor"></choosescreenshot>

- alpha
- beta
`;

function render(onRemoveBlock?: () => void) {
  return renderToStaticMarkup(
    <AIResponse
      imageBasePath="/videos/1"
      extraComponents={{ choosescreenshot: () => null } as never}
      onRemoveBlock={onRemoveBlock}
    >
      {DOC}
    </AIResponse>
  );
}

function countRemoveButtons(html: string) {
  return html.split(`aria-label="Remove"`).length - 1;
}

describe("AIResponse remove-block control", () => {
  it("renders no remove buttons without a handler", () => {
    expect(countRemoveButtons(render())).toBe(0);
  });

  it("renders one remove button per prose block, skipping the custom component", () => {
    // h1, intro paragraph, two list items — but not the paragraph that exists
    // only to host <choosescreenshot>, which brings its own remove control.
    expect(countRemoveButtons(render(() => {}))).toBe(4);
  });
});
