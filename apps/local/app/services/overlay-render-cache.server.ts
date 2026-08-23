import crypto from "node:crypto";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Effect } from "effect";
import {
  OverlayContentRenderError,
  OverlayContentRendererService,
} from "./overlay-content-renderer";
import {
  resolveOverlayRenderPath,
  type OverlayContent,
} from "./overlay-render-cache";

/**
 * The Overlay Render Cache: the persistent directory of rendered Overlay
 * content — Definition Cards and Bullet Panels alike — one `.mov` per distinct
 * piece of content, addressed by that content.
 *
 * It is a cache in the strict sense — every file in it can be rebuilt from the
 * database, and deleting the whole directory costs nothing but time. So it
 * holds no index and no metadata: the file's own name is the question, and its
 * existence is the answer.
 *
 * It is separate from the whole-export cache on purpose. A course video is
 * re-exported whenever any Clip of it moves; its Definition Cards are not
 * re-rendered unless the cards themselves changed, which is what keeps a
 * 40-minute video's re-export from booting Chromium once per card.
 */
export class OverlayRenderCacheService extends Effect.Service<OverlayRenderCacheService>()(
  "OverlayRenderCacheService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const renderer = yield* OverlayContentRendererService;

      // Read at layer construction, not inside the render. A key read only
      // where it is used turns a missing `.env` line into a failure that
      // appears minutes into an export, after the concat and normalize passes
      // have already run — see `.sandcastle/CODING_STANDARDS.md`.
      const cacheDir = yield* Config.string("OVERLAY_RENDER_CACHE_DIRECTORY");

      /**
       * The path to this Overlay content's rendered `.mov`, rendering it
       * first if the cache does not already hold it. One method for every
       * Overlay Kind: which kind it is only decides the props the renderer is
       * handed, and every kind is cached, addressed and stored the same way.
       *
       * `courseId` scopes the file name only — the same content under two
       * courses is rendered twice, so a course's renders can be swept up on
       * their own later. Standalone videos (no course) pass their own video
       * id, exactly as the export path does.
       */
      const renderOverlay = Effect.fn("renderOverlay")(function* (opts: {
        courseId: string;
        content: OverlayContent;
      }) {
        const cachedPath = resolveOverlayRenderPath(
          cacheDir,
          opts.courseId,
          opts.content
        );

        const alreadyRendered = yield* fs
          .exists(cachedPath)
          .pipe(Effect.mapError(cacheFailure(`inspect ${cachedPath}`)));

        if (alreadyRendered) return cachedPath;

        yield* fs
          .makeDirectory(cacheDir, { recursive: true })
          .pipe(Effect.mapError(cacheFailure(`create ${cacheDir}`)));

        // The renderer writes to a scratch name and the finished file is
        // moved into place, because the cache's only record of a hit is that
        // the addressed file exists. A render killed halfway would otherwise
        // leave a truncated `.mov` sitting at a valid address, and every
        // later export would happily composite it.
        //
        // The scratch name keeps the cached name's extension. Remotion reads
        // the output extension to decide the container, and refuses a ProRes
        // render to any name that does not end in `mov`, `mkv` or `mxf` — so
        // a scratch name ending in `.partial` fails every render before a
        // single frame is drawn.
        const cachedExtension = path.extname(cachedPath);
        const scratchPath = path.join(
          cacheDir,
          `.${path.basename(cachedPath, cachedExtension)}.${crypto.randomUUID()}.partial${cachedExtension}`
        );

        yield* renderer
          .renderOverlayContent(opts.content, scratchPath)
          .pipe(
            Effect.tapError(() =>
              fs.remove(scratchPath).pipe(Effect.catchAll(() => Effect.void))
            )
          );

        yield* fs
          .rename(scratchPath, cachedPath)
          .pipe(Effect.mapError(cacheFailure(`store ${cachedPath}`)));

        return cachedPath;
      });

      return { renderOverlay };
    }),
    dependencies: [NodeContext.layer, OverlayContentRendererService.Default],
  }
) {}

/**
 * Every way the cache itself can fail is a disk problem, and every caller wants
 * the same thing from one: the render did not happen. They are folded into the
 * renderer's own error rather than given a second tagged error nobody would
 * handle differently.
 */
const cacheFailure = (what: string) => (cause: unknown) =>
  new OverlayContentRenderError({
    cause,
    message: `Overlay Render Cache: failed to ${what}`,
  });
