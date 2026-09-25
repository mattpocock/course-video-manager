import { describe, expect, it } from "vitest";
import { renderInRouter } from "@/test-utils/render-in-router";
import { EditorCompactHeader } from "./editor-compact-header";

const props = {
  backButtonUrl: "/courses/c1",
  breadcrumb: "Section/Lesson/Video",
  nextVideoId: null,
  previousVideoId: null,
  showTabSwitcher: true,
  videoId: "v1",
  lessonId: "l1",
};

describe("EditorCompactHeader", () => {
  it("opens the Animatic from the editor header when the Video has Clip Mockups", () => {
    const html = renderInRouter(
      <EditorCompactHeader {...props} hasAnimatic={true} />
    );

    // This is the only way into the Animatic from the editor. Without it an
    // author in the editor cannot see that an Animatic exists at all.
    expect(html).toContain('href="/videos/v1/animatic"');
    expect(html).toContain("Animatic");

    // In THIS tab. A second tab left the author with two editors of the same
    // Video open, and the Animatic is a page of the Video like any other.
    expect(html).not.toContain('target="_blank"');
  });

  it("offers nothing to watch when the Video has no Clip Mockups", () => {
    const html = renderInRouter(
      <EditorCompactHeader {...props} hasAnimatic={false} />
    );

    expect(html).not.toContain("/videos/v1/animatic");
  });
});
