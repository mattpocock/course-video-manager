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
import { z } from "zod";
import {
  CHAT_HIGHLIGHT_COMPOSITION_ID,
  chatHighlightCardSchema,
} from "./chat-highlight-card";

const packageRoot = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const entryPoint = path.join(packageRoot, "remotion", "card-server-index.ts");
const publicDir = path.join(packageRoot, "public");

const USAGE = `Serve Chat Highlight card stills, one PNG per request.

Usage:
  card-server [--frame-width <px>]

Starts once: bundles the card, opens one headless Chromium with software GL,
renders a warm-up card, then prints a ready line. After that, every line on
stdin is a request and gets one line back on stdout. Requests are answered in
order. Closing stdin closes Chromium and exits.

Options:
  --frame-width <px>  The stream's frame width (default 1920). The card scales
                      by frameWidth / 1920.
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

const requestSchema = chatHighlightCardSchema.extend({ id: z.string() });

/** The warm-up card: loads the fonts and the page before Matt's first click. */
const WARM_UP = { author: "@warm_up", text: "Warming up the card server." };

const parseArgs = (argv: string[]) => {
  const args = { frameWidth: 1920, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--frame-width":
        args.frameWidth = Number(argv[++i]);
        if (!Number.isFinite(args.frameWidth) || args.frameWidth <= 0) {
          throw new Error("--frame-width must be a positive number.");
        }
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
};

const reply = (line: Record<string, unknown>) => {
  process.stdout.write(JSON.stringify(line) + "\n");
};

export const main = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv);
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

  const serveUrl = await bundle({
    entryPoint,
    webpackOverride: enableTailwind,
    publicDir,
  });

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

  reply({
    type: "ready",
    width: composition.width,
    height: composition.height,
    startMs: Math.round(performance.now() - started),
    warmRenderMs,
  });

  const answer = async (line: string) => {
    let id: string | null = null;
    try {
      const request = requestSchema.parse(JSON.parse(line));
      id = request.id;
      const renderStarted = performance.now();
      const png = await render(request);
      reply({
        type: "card",
        id,
        width: composition.width,
        height: composition.height,
        renderMs: Math.round(performance.now() - renderStarted),
        png: png.toString("base64"),
      });
    } catch (error) {
      reply({
        type: "error",
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // One render at a time, in arrival order: a burst of clicks queues rather
  // than opening several pages at once.
  let queue = Promise.resolve();
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    // A parent that cannot close our stdin (the recorder's launcher) says so.
    if (line.trim() === "quit") return void lines.close();
    queue = queue.then(() => answer(line));
  });
  await new Promise<void>((resolve) => lines.once("close", resolve));
  await queue;
  await browser.close({ silent: true });
};
