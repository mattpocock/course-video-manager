import crypto from "node:crypto";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Effect } from "effect";
import {
  DefinitionCardRenderError,
  DefinitionCardRendererService,
} from "./definition-card-renderer";
import {
  resolveDefinitionCardRenderPath,
  type DefinitionCardContent,
} from "./overlay-render-cache";

/**
 * The Overlay Render Cache: the persistent directory of rendered Definition
 * Cards, one `.mov` per distinct piece of card content, addressed by that
 * content.
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
      const renderer = yield* DefinitionCardRendererService;

      /**
       * The path to this Definition Card's rendered `.mov`, rendering it first
       * if the cache does not already hold it.
       *
       * `courseId` scopes the file name only — the same content under two
       * courses is rendered twice, so a course's renders can be swept up on
       * their own later. Standalone videos (no course) pass their own video
       * id, exactly as the export path does.
       */
      const renderDefinitionCard = Effect.fn("renderDefinitionCard")(
        function* (opts: { courseId: string; content: DefinitionCardContent }) {
          const cacheDir = yield* Config.string(
            "OVERLAY_RENDER_CACHE_DIRECTORY"
          );

          const cachedPath = resolveDefinitionCardRenderPath(
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
          const scratchPath = path.join(
            cacheDir,
            `.${path.basename(cachedPath)}.${crypto.randomUUID()}.partial`
          );

          yield* renderer
            .renderDefinitionCard(opts.content, scratchPath)
            .pipe(
              Effect.tapError(() =>
                fs.remove(scratchPath).pipe(Effect.catchAll(() => Effect.void))
              )
            );

          yield* fs
            .rename(scratchPath, cachedPath)
            .pipe(Effect.mapError(cacheFailure(`store ${cachedPath}`)));

          return cachedPath;
        }
      );

      return { renderDefinitionCard };
    }),
    dependencies: [NodeContext.layer, DefinitionCardRendererService.Default],
  }
) {}

/**
 * Every way the cache itself can fail is a disk problem, and every caller wants
 * the same thing from one: the render did not happen. They are folded into the
 * renderer's own error rather than given a second tagged error nobody would
 * handle differently.
 */
const cacheFailure = (what: string) => (cause: unknown) =>
  new DefinitionCardRenderError({
    cause,
    message: `Overlay Render Cache: failed to ${what}`,
  });
