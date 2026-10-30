import { existsSync } from "node:fs";
import { join } from "node:path";
import { installLocationRepoRoot } from "@/services/repo-env";

/**
 * THE CARD SERVER'S BROWSER: the Chat Highlight card server
 * (`packages/overlay-renderer/card-server.mjs`) draws in Remotion's Chrome
 * Headless Shell, which Remotion would download (~109 MB) on first use. That
 * must never happen at Go Live, so it is fetched once, ahead, with
 * `browser:ensure`, and Go Live is refused until it has been. The card server
 * itself refuses to download it too.
 *
 * Where Remotion keeps it: `node_modules/.remotion` of the package the card
 * server runs from, for this platform (Linux x64: WSL).
 */
export const cardBrowserPath = (
  repoRoot: string | undefined = installLocationRepoRoot()
) =>
  repoRoot === undefined
    ? undefined
    : join(
        repoRoot,
        "packages/overlay-renderer/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"
      );

/** Why Go Live is refused while the card server's browser is not downloaded. */
export const CARD_BROWSER_MISSING =
  "The Chat Highlight card's browser is not downloaded: run `pnpm --filter @cvm/overlay-renderer browser:ensure` once, online, then Go Live again.";

/** The reason to refuse Go Live, if the browser at `path` is missing. */
export const cardBrowserRefusal = (
  path: string | undefined = cardBrowserPath()
) => (path !== undefined && existsSync(path) ? [] : [CARD_BROWSER_MISSING]);
