import { cancelRender, continueRender, delayRender } from "remotion";
import emoji from "@fontsource/noto-color-emoji/files/noto-color-emoji-emoji-400-normal.woff2";

/**
 * Noto Color Emoji (OFL) from a file inside the bundle, so a chat message's
 * emoji are drawn in colour (#2658). The card server and a Short's render run
 * Chromium under WSL, which has no emoji font of its own: without this every
 * emoji was drawn as nothing. Bundled, like DM Sans, so no render makes a
 * network call. One file, every emoji; the render waits until it has loaded.
 */
export const EMOJI_FONT_FAMILY = "Noto Color Emoji";

// Every browser has FontFace; only Node (a test importing the preview) lacks
// it, and draws nothing there. Remotion's own font loaders skip it the same way.
if (typeof FontFace !== "undefined") {
  const handle = delayRender("Loading bundled Noto Color Emoji");
  new FontFace(EMOJI_FONT_FAMILY, `url(${emoji}) format("woff2")`)
    .load()
    .then((face) => {
      document.fonts.add(face);
      continueRender(handle);
    }, cancelRender);
}
