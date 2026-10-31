import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * THE CARD SERVER'S BROWSER: the Chat Highlight card server
 * (`packages/overlay-renderer/card-server.mjs`) draws in Remotion's Chrome
 * Headless Shell, which Remotion would download (~109 MB) on first use. That
 * must never happen live, so it is fetched once, ahead, with
 * `browser:ensure`. Without it Go Live still goes ahead: only Chat Highlights
 * are unavailable, and the Live Stream and its recording are unaffected. The
 * card server itself refuses to download it too.
 *
 * Where Remotion keeps it: `node_modules/.remotion` of the package the card
 * server runs from, for this platform (Linux x64: WSL).
 */
export const cardBrowserPath = (repoRoot: string | undefined) =>
  repoRoot === undefined
    ? undefined
    : join(
        repoRoot,
        "packages/overlay-renderer/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"
      );

/** Why a Chat Highlight is refused while the card server's browser is not downloaded. */
export const CHAT_HIGHLIGHTS_UNAVAILABLE =
  "Chat Highlights are unavailable: the card's browser is not downloaded. The Live Stream and its recording are unaffected. Run `pnpm --filter @cvm/overlay-renderer browser:ensure` once, online, then click the message again.";

/** Why Chat Highlights are unavailable, if the browser at `path` is missing; null when they are available. */
export const chatHighlightsUnavailable = (path: string | undefined) =>
  path !== undefined && existsSync(path) ? null : CHAT_HIGHLIGHTS_UNAVAILABLE;
