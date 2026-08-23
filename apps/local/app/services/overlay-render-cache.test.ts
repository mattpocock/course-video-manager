import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  computeDefinitionCardContentHash,
  definitionCardContentHashAtVersion,
  definitionCardFilename,
  resolveDefinitionCardRenderPath,
  OVERLAY_RENDERER_VERSION,
  type DefinitionCardContent,
} from "@/services/overlay-render-cache";

const card = (
  overrides: Partial<DefinitionCardContent> = {}
): DefinitionCardContent => ({
  title: "Hydration",
  description: "Attaching React to server-rendered HTML.",
  durationInSeconds: 4,
  ...overrides,
});

describe("overlay-render-cache", () => {
  describe("computeDefinitionCardContentHash", () => {
    it("returns a 32-char hex string", () => {
      expect(computeDefinitionCardContentHash(card())).toMatch(
        /^[0-9a-f]{32}$/
      );
    });

    it("is stable for the same content", () => {
      expect(computeDefinitionCardContentHash(card())).toBe(
        computeDefinitionCardContentHash(card())
      );
    });

    it("changing the title changes the hash", () => {
      expect(computeDefinitionCardContentHash(card())).not.toBe(
        computeDefinitionCardContentHash(card({ title: "Streaming" }))
      );
    });

    it("changing the description changes the hash", () => {
      expect(computeDefinitionCardContentHash(card())).not.toBe(
        computeDefinitionCardContentHash(
          card({ description: "Something else entirely." })
        )
      );
    });

    it("changing the duration changes the hash", () => {
      expect(computeDefinitionCardContentHash(card())).not.toBe(
        computeDefinitionCardContentHash(card({ durationInSeconds: 4.5 }))
      );
    });

    it("does not confuse a title/description swap for the same card", () => {
      expect(
        computeDefinitionCardContentHash(card({ title: "a", description: "b" }))
      ).not.toBe(
        computeDefinitionCardContentHash(card({ title: "b", description: "a" }))
      );
    });

    it("bumping the Overlay Renderer Version changes the hash", () => {
      expect(
        definitionCardContentHashAtVersion(card(), OVERLAY_RENDERER_VERSION + 1)
      ).not.toBe(computeDefinitionCardContentHash(card()));
    });

    it("hashes at the current Overlay Renderer Version", () => {
      expect(
        definitionCardContentHashAtVersion(card(), OVERLAY_RENDERER_VERSION)
      ).toBe(computeDefinitionCardContentHash(card()));
    });
  });

  describe("definitionCardFilename", () => {
    it("names the file {courseId}-{contentHash}.mov", () => {
      const hash = computeDefinitionCardContentHash(card());
      expect(definitionCardFilename("course-1", hash)).toBe(
        `course-1-${hash}.mov`
      );
    });
  });

  describe("resolveDefinitionCardRenderPath", () => {
    it("puts the render in the cache directory", () => {
      expect(
        resolveDefinitionCardRenderPath("/cache/overlays", "course-1", card())
      ).toBe(
        path.join(
          "/cache/overlays",
          definitionCardFilename(
            "course-1",
            computeDefinitionCardContentHash(card())
          )
        )
      );
    });

    it("gives identical content under the same course one path", () => {
      expect(
        resolveDefinitionCardRenderPath("/cache/overlays", "course-1", card())
      ).toBe(
        resolveDefinitionCardRenderPath("/cache/overlays", "course-1", card())
      );
    });

    it("gives identical content under a different course a different path", () => {
      expect(
        resolveDefinitionCardRenderPath("/cache/overlays", "course-1", card())
      ).not.toBe(
        resolveDefinitionCardRenderPath("/cache/overlays", "course-2", card())
      );
    });
  });
});
