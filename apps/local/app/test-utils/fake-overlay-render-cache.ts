import { Effect, Layer } from "effect";
import path from "node:path";
import { OverlayRenderCacheService } from "@/services/overlay-render-cache.server";
import {
  computeDefinitionCardContentHash,
  type DefinitionCardContent,
} from "@/services/overlay-render-cache";

/** One thing the export step asked the Overlay Render Cache to hand it. */
export type FakeCardRenderRequest = {
  courseId: string;
  content: DefinitionCardContent;
  /** The `.mov` path the fake answered with. */
  renderPath: string;
};

/**
 * An Overlay Render Cache that never boots Chromium: it answers with the path
 * a real render WOULD have, content-addressed exactly as the real cache
 * addresses it, and records what it was asked for.
 *
 * This is the boundary a test is allowed to fake — a real render is a real
 * browser, which no test in this repo may drive (see
 * `.sandcastle/CODING_STANDARDS.md`). Everything on this side of it — which
 * cards are asked for, and where they land — stays real.
 */
export const createFakeOverlayRenderCache = (opts?: {
  /** Where the pretend renders live. Default: a fixed, obviously-fake dir. */
  directory?: string;
}) => {
  const directory = opts?.directory ?? "/fake-overlay-render-cache";
  const requests: FakeCardRenderRequest[] = [];

  const layer = Layer.succeed(OverlayRenderCacheService, {
    renderDefinitionCard: (request: {
      courseId: string;
      content: DefinitionCardContent;
    }) =>
      Effect.sync(() => {
        const renderPath = path.join(
          directory,
          `${request.courseId}-${computeDefinitionCardContentHash(request.content)}.mov`
        );
        requests.push({ ...request, renderPath });
        return renderPath;
      }),
  } as unknown as OverlayRenderCacheService);

  return { layer, requests };
};

/** The same fake, for a test that only needs the wiring to exist. */
export const fakeOverlayRenderCacheLayer = () =>
  createFakeOverlayRenderCache().layer;
