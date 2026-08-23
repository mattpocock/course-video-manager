import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Where the Remotion overlay renderer's CLI entry point lives on disk.
 *
 * The renderer (`packages/overlay-renderer`) is deliberately NOT a workspace
 * dependency of `apps/local`: every root script filters it out so Remotion and
 * its Chromium download stay out of the application's checks. The only coupling
 * is this subprocess path, so it has to be resolved by hand.
 *
 * It is resolved by walking up to the WORKSPACE ROOT — the directory holding
 * `pnpm-workspace.yaml`, the same anchor `app/cli/env.ts` uses for `.env` —
 * rather than by counting `../` from this module. A fixed hop count is wrong in
 * two places at once: it was left pointing at a non-existent
 * `apps/local/packages/...` by the move into `apps/`, and it would be wrong
 * again from `apps/local/build/server/`, which sits at a different depth from
 * the source this bundles from.
 */
export const findWorkspaceRoot = (start: string): string | undefined => {
  let dir = start;
  while (true) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

/** Absolute path to `packages/overlay-renderer/bin.mjs`. Throws if unfound. */
export const overlayRendererBinPath = (): string => {
  const workspaceRoot = findWorkspaceRoot(import.meta.dirname);
  if (workspaceRoot === undefined) {
    throw new Error(
      "Could not locate the course-video-manager workspace root, so the overlay renderer's bin.mjs cannot be resolved."
    );
  }
  return path.join(workspaceRoot, "packages", "overlay-renderer", "bin.mjs");
};
