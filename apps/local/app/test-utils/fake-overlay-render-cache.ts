import { Effect, Layer } from "effect";
import path from "node:path";
import { OverlayRenderCacheService } from "@/services/overlay-render-cache.server";
import {
  computeOverlayContentHash,
  type OverlayContent,
} from "@/services/overlay-render-cache";

/** One thing the export step asked the Overlay Render Cache to hand it. */
export type FakeOverlayRenderRequest = {
  courseId: string;
  content: OverlayContent;
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
 * content is asked for, and where it lands — stays real. It uses the REAL
 * {@link computeOverlayContentHash}, so a test asserting the answered path is
 * asserting the address a real export would have used.
 */
export const createFakeOverlayRenderCache = (opts?: {
  /** Where the pretend renders live. Default: a fixed, obviously-fake dir. */
  directory?: string;
  /**
   * Fail every render with this error instead of answering with a path — a
   * Chromium that will not start, a cache directory that cannot be written.
   * The request is still recorded, so a test can tell "asked and failed" from
   * "never asked".
   */
  failWith?: unknown;
}) => {
  const directory = opts?.directory ?? "/fake-overlay-render-cache";
  const requests: FakeOverlayRenderRequest[] = [];

  const layer = Layer.succeed(OverlayRenderCacheService, {
    renderOverlay: (request: { courseId: string; content: OverlayContent }) =>
      Effect.suspend(() => {
        const renderPath = path.join(
          directory,
          `${request.courseId}-${computeOverlayContentHash(request.content)}.mov`
        );
        requests.push({ ...request, renderPath });
        return opts?.failWith === undefined
          ? Effect.succeed(renderPath)
          : Effect.fail(opts.failWith);
      }),
  } as unknown as OverlayRenderCacheService);

  return { layer, requests };
};
