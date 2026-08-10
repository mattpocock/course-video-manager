import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROUTES_DIR = path.join(import.meta.dirname, "..", "routes");

const VIDEO_SUB_ROUTES = [
  "_app.videos.$videoId.edit.tsx",
  "_app.videos.$videoId.lesson.tsx",
  "_app.videos.$videoId.post.tsx",
  "_app.videos.$videoId.social.tsx",
  "_app.videos.$videoId.ai-hero.tsx",
  "_app.videos.$videoId.skills-changelog.tsx",
  "_app.videos.$videoId.newsletter.tsx",
  "_app.videos.$videoId.move-to-course.tsx",
  "_app.videos.$videoId.thumbnails.tsx",
];

const NON_EDIT_ROUTES = VIDEO_SUB_ROUTES.filter(
  (r) => r !== "_app.videos.$videoId.edit.tsx"
);

describe("video sub-routes fullscreen handle", () => {
  for (const route of VIDEO_SUB_ROUTES) {
    it(`${route} exports handle with fullscreen: true`, () => {
      const filePath = path.join(ROUTES_DIR, route);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toMatch(
        /export\s+const\s+handle\s*=\s*\{[^}]*fullscreen:\s*true[^}]*\}/
      );
    });
  }
});

describe("only edit route hides the parent header", () => {
  it("edit route exports handle with hideParentHeader: true", () => {
    const filePath = path.join(ROUTES_DIR, "_app.videos.$videoId.edit.tsx");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toMatch(
      /export\s+const\s+handle\s*=\s*\{[^}]*hideParentHeader:\s*true[^}]*\}/
    );
  });

  for (const route of NON_EDIT_ROUTES) {
    it(`${route} does NOT export hideParentHeader`, () => {
      const filePath = path.join(ROUTES_DIR, route);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toMatch(/hideParentHeader/);
    });
  }
});

describe("parent video layout uses hideParentHeader, not fullscreen", () => {
  it("checks handle.hideParentHeader to hide the shared header", () => {
    const filePath = path.join(ROUTES_DIR, "_app.videos.$videoId.tsx");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toMatch(/hideParentHeader/);
    expect(content).not.toMatch(
      /isFullscreenChild|handle\.fullscreen|fullscreen.*header/i
    );
  });
});
