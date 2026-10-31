import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  ensureBrowser,
  openBrowser,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";
import { CHAT_HIGHLIGHT_COMPOSITION_ID } from "./chat-highlight-card";
import {
  parseCardServerArgs,
  serveCardRequests,
  type CardServerReply,
} from "./card-server-protocol";

const packageRoot = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const entryPoint = path.join(packageRoot, "remotion", "card-server-index.ts");
const publicDir = path.join(packageRoot, "public");

const USAGE = `Serve Chat Highlight card stills, one PNG per request.

Usage:
  card-server [--frame-width <px>] [--prepare]

Starts once: bundles the card, opens one headless Chromium with software GL,
renders a warm-up card, then prints a ready line. After that, every line on
stdin is a request and gets one line back on stdout. Requests are answered in
order. Closing stdin closes Chromium and exits.

Options:
  --frame-width <px>  The stream's frame width (default 1920). The card scales
                      by frameWidth / 1920.
  --prepare           Bundle the card into its cache, then exit (run by
                      browser:ensure, so Go Live never waits on webpack).
  -h, --help          Show this help.

stdout lines (JSON):
  {"type":"ready","width","height","startMs","warmRenderMs"}
  {"type":"card","id","width","height","renderMs","png":"<base64>"}
  {"type":"error","id","message"}     (id is null if the line didn't parse)

stdin lines (JSON):
  {"id":"<string>","author":"<string>","text":"<string>"}
  quit                                (as closing stdin: finish, then exit)

The PNG is the card's settled frame on a transparent canvas of the ready
line's fixed size. The card sits at the canvas's bottom left.`;

/**
 * Why the card server will not start: Chrome Headless Shell (~109 MB) is not
 * downloaded. It is fetched once, ahead, never when Matt goes live.
 */
export const BROWSER_MISSING =
  "Chrome Headless Shell is not downloaded: run `pnpm --filter @cvm/overlay-renderer browser:ensure` once, online.";

/** The warm-up card: loads the fonts and the page before Matt's first click. */
const WARM_UP = { author: "@warm_up", text: "Warming up the card server." };

/** Every file the card's bundle is built from: a change to any makes a new bundle. */
const BUNDLE_INPUTS = [
  "remotion",
  "src",
  "public",
  "package.json",
  "postcss.config.mjs",
];

const filesUnder = (p: string): string[] =>
  !fs.existsSync(p)
    ? []
    : fs.statSync(p).isDirectory()
      ? fs
          .readdirSync(p)
          .sort()
          .flatMap((name) => filesUnder(path.join(p, name)))
      : [p];

/**
 * The card's webpack bundle, cached by a hash of what it is built from: a
 * bundle takes seconds of CPU, so it is built once (`--prepare`, from
 * `browser:ensure`) and every start after reuses it (#2445 review: the
 * first click must land within a second of going live).
 */
const cachedBundle = async () => {
  const hash = createHash("sha256");
  for (const file of BUNDLE_INPUTS.flatMap((p) =>
    filesUnder(path.join(packageRoot, p))
  )) {
    hash.update(path.relative(packageRoot, file));
    hash.update(fs.readFileSync(file));
  }
  const outDir = path.join(
    packageRoot,
    "node_modules/.cache/card-server-bundle",
    hash.digest("hex").slice(0, 16)
  );
  if (fs.existsSync(path.join(outDir, "index.html"))) return outDir;
  console.error(
    "card server: bundling the card (its first start since a change)"
  );
  // Built beside, then moved in: a bundle cut short is never reused.
  const building = `${outDir}.building-${process.pid}`;
  await bundle({
    entryPoint,
    webpackOverride: enableTailwind,
    publicDir,
    outDir: building,
  });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(building, outDir);
  return outDir;
};

const reply = (line: CardServerReply) => {
  process.stdout.write(JSON.stringify(line) + "\n");
};

export const main = async (argv: string[]): Promise<void> => {
  const args = parseCardServerArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    return;
  }

  // stdout carries the protocol and nothing else. Remotion logs through
  // console.log and console.info (a first-run browser download, for one), so
  // those go to stderr with the rest of the diagnostics.
  console.log = console.error;
  console.info = console.error;

  const started = performance.now();

  // The card server runs during takes, so it takes the lowest CPU priority
  // (nice 19 on Linux, idle on Windows) and yields to the recorder.
  // Set before Chromium launches, so its processes inherit the priority.
  os.setPriority(os.constants.priority.PRIORITY_LOW);

  // Never a download here: Remotion would fetch the browser on first use,
  // which at Go Live means ~109 MB before the first card. It is fetched
  // ahead (`browser:ensure`), or the card server says so and quits.
  await ensureBrowser({
    onBrowserDownload: () => {
      throw new Error(BROWSER_MISSING);
    },
  });

  const serveUrl = await cachedBundle();
  if (args.prepare) return;

  // Software GL (ANGLE on SwiftShader): the card is a still of a few divs, and
  // the GPU belongs to the stream's NVENC and the screen recorder's ddagrab.
  const chromiumOptions = { gl: "swangle" as const };
  const browser = await openBrowser("chrome", { chromiumOptions });

  const frameWidth = args.frameWidth;
  const composition = await selectComposition({
    serveUrl,
    id: CHAT_HIGHLIGHT_COMPOSITION_ID,
    inputProps: { ...WARM_UP, frameWidth },
    puppeteerInstance: browser,
    chromiumOptions,
  });

  const render = async (card: { author: string; text: string }) => {
    const props = { ...card, frameWidth };
    const { buffer } = await renderStill({
      // renderStill draws `composition.props`, not `inputProps`: without this
      // every click would render the warm-up card. The canvas size depends
      // only on frameWidth, so the selected metadata holds for every card.
      composition: { ...composition, props },
      serveUrl,
      inputProps: props,
      frame: 0,
      imageFormat: "png",
      output: null,
      puppeteerInstance: browser,
      chromiumOptions,
    });
    if (!buffer) throw new Error("renderStill returned no PNG.");
    return buffer;
  };

  const warmStarted = performance.now();
  await render(WARM_UP);
  const warmRenderMs = Math.round(performance.now() - warmStarted);

  const lines = readline.createInterface({ input: process.stdin });
  await serveCardRequests({
    lines,
    ready: {
      width: composition.width,
      height: composition.height,
      startMs: Math.round(performance.now() - started),
      warmRenderMs,
    },
    render,
    reply,
    now: () => performance.now(),
  });
  lines.close();
  await browser.close({ silent: true });
};
