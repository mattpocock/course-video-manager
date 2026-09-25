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

    // Without this the only way in is the Mockups tab of the side panel, and an
    // author in the editor cannot see that an Animatic exists at all.
    expect(html).toContain('href="/videos/v1/animatic"');
    expect(html).toContain("Animatic");
  });

  it("offers nothing to watch when the Video has no Clip Mockups", () => {
    const html = renderInRouter(
      <EditorCompactHeader {...props} hasAnimatic={false} />
    );

    expect(html).not.toContain("/videos/v1/animatic");
  });
});
