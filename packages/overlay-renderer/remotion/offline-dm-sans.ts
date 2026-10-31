import { cancelRender, continueRender, delayRender } from "remotion";
import latin from "@fontsource-variable/dm-sans/files/dm-sans-latin-standard-normal.woff2";
import latinExt from "@fontsource-variable/dm-sans/files/dm-sans-latin-ext-standard-normal.woff2";
import { FONT_FAMILY } from "../src/definition-card-tokens";

/**
 * DM Sans from files inside the bundle, never from Google Fonts, so a render
 * makes no network call. The card server needs that: a click must never wait
 * on the network, and the rig may be offline.
 *
 * The same variable font Google serves (every weight in one file), split by
 * unicode range as Google splits it. Registered under the tokens' own family
 * name, and the render waits until both faces have loaded.
 */
const FACES = [
  {
    url: latin,
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  },
  {
    url: latinExt,
    unicodeRange:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  },
];

const handle = delayRender("Loading bundled DM Sans");

Promise.all(
  FACES.map(async ({ url, unicodeRange }) => {
    const face = new FontFace(FONT_FAMILY, `url(${url}) format("woff2")`, {
      weight: "100 1000",
      style: "normal",
      unicodeRange,
    });
    document.fonts.add(await face.load());
  })
).then(
  () => continueRender(handle),
  (error) => cancelRender(error)
);

export const fontFamily = FONT_FAMILY;
