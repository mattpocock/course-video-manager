import { Effect } from "effect";
import { effectiveClipScene } from "@cvm/core/features/videos/effective-scene";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { notFound } from "@/cli/helpers";

/**
 * What the `cvm clip` verb modules share, split out of clip.ts to keep it
 * under the repo's per-file token budget.
 */

/** Every reported Clip carries the scene rules judge it on (see GLOSSARY Scene Override). */
export const withEffectiveScene = <
  C extends Parameters<typeof effectiveClipScene>[0],
>(
  clip: C
) => ({ ...clip, effectiveScene: effectiveClipScene(clip) });

/**
 * Resolve + gate a clip for a write: a bad id is a clean not-found (exit 2)
 * rather than arriving as a service failure, and archived clips are deleted
 * as far as this noun is concerned, so they are not-found too.
 */
export const requireActiveClip = (id: string) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [existing] = yield* clipOps.getClipsByIds([id]);
    if (!existing || existing.archived) {
      return yield* notFound("clip", id);
    }
    return existing;
  });
