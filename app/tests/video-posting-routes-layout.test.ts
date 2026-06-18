import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROUTES_DIR = path.join(__dirname, "..", "routes");

const VIDEO_POSTING_ROUTES = [
  "_app.videos.$videoId.post.tsx",
  "_app.videos.$videoId.social.tsx",
  "_app.videos.$videoId.ai-hero.tsx",
  "_app.videos.$videoId.skills-changelog.tsx",
  "_app.videos.$videoId.newsletter.tsx",
];

describe("video posting routes use VideoPostingLayout", () => {
  for (const route of VIDEO_POSTING_ROUTES) {
    it(`${route} imports and renders VideoPostingLayout`, () => {
      const content = fs.readFileSync(path.join(ROUTES_DIR, route), "utf-8");
      expect(content).toContain(
        'import { VideoPostingLayout } from "@/features/video-posting/video-posting-layout"'
      );
      expect(content).toContain("<VideoPostingLayout");
    });
  }

  for (const route of VIDEO_POSTING_ROUTES) {
    it(`${route} does not contain duplicated shell code`, () => {
      const content = fs.readFileSync(path.join(ROUTES_DIR, route), "utf-8");
      expect(content).not.toContain("useState<Set<string>>");
      expect(content).not.toContain("handleFileClick");
      expect(content).not.toContain("handleEditFile");
      expect(content).not.toContain("handleDeleteFile");
      expect(content).not.toContain("FilePreviewModal");
      expect(content).not.toContain("AddLinkModal");
      expect(content).not.toContain("StandaloneFileManagementModal");
      expect(content).not.toContain("DeleteStandaloneFileModal");
      expect(content).not.toContain("LessonFilePasteModal");
    });
  }
});

describe("post route unique behaviors", () => {
  const postContent = fs.readFileSync(
    path.join(ROUTES_DIR, "_app.videos.$videoId.post.tsx"),
    "utf-8"
  );

  it("passes videoSlot prop with conditional video/placeholder", () => {
    expect(postContent).toContain("videoSlot=");
    expect(postContent).toContain("videoExists");
    expect(postContent).toContain("VideoOffIcon");
  });

  it("passes onRevealInFileSystem only when video exists", () => {
    expect(postContent).toContain("onRevealInFileSystem=");
    expect(postContent).toMatch(/videoExists\s*\?\s*\(\)/);
  });

  it("uses Video component with preload=none", () => {
    expect(postContent).toContain('preload="none"');
  });

  it("passes route-specific data through children render prop", () => {
    expect(postContent).toContain(
      "isYoutubeAuthenticated={isYoutubeAuthenticated}"
    );
    expect(postContent).toContain("thumbnails={thumbnails}");
    expect(postContent).toContain("pitchYoutubeTitle={pitchYoutubeTitle}");
  });
});
