import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  computeOverlayContentHash,
  overlayContentHashAtVersion,
  overlayRenderFilename,
  resolveOverlayRenderPath,
  OVERLAY_RENDERER_VERSION,
  type BulletPanelContent,
  type DefinitionCardContent,
} from "@/services/overlay-render-cache";

const card = (
  overrides: Partial<DefinitionCardContent> = {}
): DefinitionCardContent => ({
  kind: "definitionCard",
  title: "Hydration",
  description: "Attaching React to server-rendered HTML.",
  durationInSeconds: 4,
  ...overrides,
});

const panel = (
  overrides: Partial<BulletPanelContent> = {}
): BulletPanelContent => ({
  kind: "bulletPanel",
  title: "What a Server Component does",
  bullets: [
    { icon: "circle-check", text: "Runs on the server", revealAt: 0.5 },
    { icon: "database", text: "Reaches the database", revealAt: 2 },
  ],
  durationInSeconds: 6,
  disableEnterAnimation: false,
  disableExitAnimation: false,
  ...overrides,
});

/** Swap one bullet of the default panel for an edited copy of it. */
const panelWithEditedBullet = (edit: {
  icon?: string;
  text?: string;
  revealAt?: number;
}): BulletPanelContent => {
  const base = panel();
  return panel({
    bullets: [{ ...base.bullets[0]!, ...edit }, base.bullets[1]!],
  });
};

describe("overlay-render-cache", () => {
  describe("computeOverlayContentHash — Definition Cards", () => {
    it("returns a 32-char hex string", () => {
      expect(computeOverlayContentHash(card())).toMatch(/^[0-9a-f]{32}$/);
    });

    it("is stable for the same content", () => {
      expect(computeOverlayContentHash(card())).toBe(
        computeOverlayContentHash(card())
      );
    });

    it("changing the title changes the hash", () => {
      expect(computeOverlayContentHash(card())).not.toBe(
        computeOverlayContentHash(card({ title: "Streaming" }))
      );
    });

    it("changing the description changes the hash", () => {
      expect(computeOverlayContentHash(card())).not.toBe(
        computeOverlayContentHash(
          card({ description: "Something else entirely." })
        )
      );
    });

    it("changing the duration changes the hash", () => {
      expect(computeOverlayContentHash(card())).not.toBe(
        computeOverlayContentHash(card({ durationInSeconds: 4.5 }))
      );
    });

    it("does not confuse a title/description swap for the same card", () => {
      expect(
        computeOverlayContentHash(card({ title: "a", description: "b" }))
      ).not.toBe(
        computeOverlayContentHash(card({ title: "b", description: "a" }))
      );
    });

    it("bumping the Overlay Renderer Version changes the hash", () => {
      expect(
        overlayContentHashAtVersion(card(), OVERLAY_RENDERER_VERSION + 1)
      ).not.toBe(computeOverlayContentHash(card()));
    });

    it("hashes at the current Overlay Renderer Version", () => {
      expect(
        overlayContentHashAtVersion(card(), OVERLAY_RENDERER_VERSION)
      ).toBe(computeOverlayContentHash(card()));
    });

    it("keeps the address every card cached before Bullet Panels existed had", () => {
      // The literal payload the hash was built from before Overlay Kind was a
      // column. A Definition Card is the default Kind, so it names no kind at
      // all — that omission is what left every cached `.mov` on disk valid.
      expect(computeOverlayContentHash(card())).toBe(
        legacyDefinitionCardHash(card())
      );
    });
  });

  describe("computeOverlayContentHash — Bullet Panels", () => {
    it("returns a 32-char hex string", () => {
      expect(computeOverlayContentHash(panel())).toMatch(/^[0-9a-f]{32}$/);
    });

    it("is stable for the same content", () => {
      expect(computeOverlayContentHash(panel())).toBe(
        computeOverlayContentHash(panel())
      );
    });

    it("changing the panel's heading changes the hash", () => {
      expect(computeOverlayContentHash(panel())).not.toBe(
        computeOverlayContentHash(panel({ title: "Something else" }))
      );
    });

    it("editing a bullet's text changes the hash", () => {
      expect(computeOverlayContentHash(panel())).not.toBe(
        computeOverlayContentHash(
          panelWithEditedBullet({ text: "Runs on the edge" })
        )
      );
    });

    it("editing a bullet's icon changes the hash", () => {
      expect(computeOverlayContentHash(panel())).not.toBe(
        computeOverlayContentHash(panelWithEditedBullet({ icon: "server" }))
      );
    });

    it("editing a bullet's revealAt changes the hash", () => {
      expect(computeOverlayContentHash(panel())).not.toBe(
        computeOverlayContentHash(panelWithEditedBullet({ revealAt: 1.25 }))
      );
    });

    it("reordering two bullets changes the hash", () => {
      // Unlike the Export Hash's Overlay list, bullets carry their own display
      // order, so it is content and must not be sorted away.
      const base = panel();
      expect(computeOverlayContentHash(base)).not.toBe(
        computeOverlayContentHash(
          panel({ bullets: [base.bullets[1]!, base.bullets[0]!] })
        )
      );
    });

    it("adding a bullet changes the hash", () => {
      const base = panel();
      expect(computeOverlayContentHash(base)).not.toBe(
        computeOverlayContentHash(
          panel({
            bullets: [
              ...base.bullets,
              { icon: "lock", text: "Never ships to the client", revealAt: 4 },
            ],
          })
        )
      );
    });

    it("changing the duration changes the hash", () => {
      expect(computeOverlayContentHash(panel())).not.toBe(
        computeOverlayContentHash(panel({ durationInSeconds: 6.5 }))
      );
    });

    it("each Animation Toggle changes the hash — they cut the panel's own animation", () => {
      expect(computeOverlayContentHash(panel())).not.toBe(
        computeOverlayContentHash(panel({ disableEnterAnimation: true }))
      );
      expect(computeOverlayContentHash(panel())).not.toBe(
        computeOverlayContentHash(panel({ disableExitAnimation: true }))
      );
    });

    it("bumping the Overlay Renderer Version changes the hash", () => {
      expect(
        overlayContentHashAtVersion(panel(), OVERLAY_RENDERER_VERSION + 1)
      ).not.toBe(computeOverlayContentHash(panel()));
    });

    it("never collides with a Definition Card of the same title and duration", () => {
      expect(
        computeOverlayContentHash(
          panel({ title: "Hydration", durationInSeconds: 4, bullets: [] })
        )
      ).not.toBe(
        computeOverlayContentHash(
          card({ title: "Hydration", description: "", durationInSeconds: 4 })
        )
      );
    });
  });

  describe("overlayRenderFilename", () => {
    it("names the file {courseId}-{contentHash}.mov", () => {
      const hash = computeOverlayContentHash(card());
      expect(overlayRenderFilename("course-1", hash)).toBe(
        `course-1-${hash}.mov`
      );
    });
  });

  describe("resolveOverlayRenderPath", () => {
    it("puts the render in the cache directory", () => {
      expect(
        resolveOverlayRenderPath("/cache/overlays", "course-1", card())
      ).toBe(
        path.join(
          "/cache/overlays",
          overlayRenderFilename("course-1", computeOverlayContentHash(card()))
        )
      );
    });

    it("gives identical content under the same course one path", () => {
      expect(
        resolveOverlayRenderPath("/cache/overlays", "course-1", card())
      ).toBe(resolveOverlayRenderPath("/cache/overlays", "course-1", card()));
    });

    it("gives identical content under a different course a different path", () => {
      expect(
        resolveOverlayRenderPath("/cache/overlays", "course-1", card())
      ).not.toBe(
        resolveOverlayRenderPath("/cache/overlays", "course-2", card())
      );
    });

    it("gives a Bullet Panel a path of the same shape", () => {
      expect(
        resolveOverlayRenderPath("/cache/overlays", "course-1", panel())
      ).toBe(
        path.join(
          "/cache/overlays",
          overlayRenderFilename("course-1", computeOverlayContentHash(panel()))
        )
      );
    });
  });
});

/**
 * The Definition Card hash exactly as it was written before Bullet Panels — a
 * literal, so a later edit to the shared hash payload cannot quietly re-address
 * every `.mov` already on disk without this test saying so.
 */
const legacyDefinitionCardHash = (content: DefinitionCardContent): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        v: OVERLAY_RENDERER_VERSION,
        t: content.title,
        x: content.description,
        d: content.durationInSeconds,
      })
    )
    .digest("hex")
    .slice(0, 32);
