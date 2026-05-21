import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROUTES_DIR = path.join(__dirname, "..", "routes");

const VIDEO_SUB_ROUTES = [
  "_app.videos.$videoId.edit.tsx",
  "_app.videos.$videoId.post.tsx",
  "_app.videos.$videoId.social.tsx",
  "_app.videos.$videoId.ai-hero.tsx",
  "_app.videos.$videoId.skills-changelog.tsx",
  "_app.videos.$videoId.newsletter.tsx",
  "_app.videos.$videoId.write.tsx",
  "_app.videos.$videoId.move-to-course.tsx",
  "_app.videos.$videoId.thumbnails.tsx",
];

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
