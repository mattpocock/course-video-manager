import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplyButton } from "./apply-button";

const render = (overrides: Partial<Parameters<typeof ApplyButton>[0]>) =>
  renderToStaticMarkup(
    <ApplyButton
      onApply={() => {}}
      isApplying={false}
      isGenerating={false}
      unresolvedScreenshots={false}
      lintCount={0}
      {...overrides}
    />
  );

describe("ApplyButton", () => {
  it("stays enabled with lint violations, showing the orange warning", () => {
    const html = render({ lintCount: 2 });
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("text-orange-500");
    expect(html).toContain("Apply with 2 lint violations");
  });

  it("shows no warning without lint violations", () => {
    expect(render({})).not.toContain("text-orange-500");
  });
});
