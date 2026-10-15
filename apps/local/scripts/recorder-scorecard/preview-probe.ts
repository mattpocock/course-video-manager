import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { previewPath, type PreviewFeed } from "../../recorder-service/protocol";
import { CLOCK_BITS, clockBitCentre } from "./synthetic-sources";

/**
 * PREVIEW LATENCY as the editor sees it: a headless Chromium decodes the
 * service's preview feed with the editor's own frame loop
 * (`latest-frame.ts`, WebCodecs) and reads each frame's burned-in Windows
 * time back as it is drawn. Latency = Windows time when it is first drawn
 * less the time burned into it. The page reads WSL's clock, so the
 * Windows-WSL offset is handed in (`windowsClockOffset`).
 *
 * The page is served from a port of the scorecard's own, which proxies the
 * feed: the service only answers CVM's own page origins.
 */

const page = (feed: PreviewFeed) => `<!doctype html>
<canvas id="c" width="320" height="180"></canvas>
<script type="module">
const BITS = ${CLOCK_BITS};
const CENTRES = ${JSON.stringify(Array.from({ length: CLOCK_BITS }, (_, k) => clockBitCentre(k)))};
const MOD = 2 ** BITS;
const ctx = document.getElementById("c").getContext("2d", { willReadFrequently: true });
const { watchLatestFrame } = await import("/frame-loop.js");
let frame;
watchLatestFrame("${previewPath(feed)}", (f) => { frame?.close(); frame = f; });
window.__offset = 0;
window.__latencies = [];
let last = -1;
const draw = () => {
  requestAnimationFrame(draw);
  if (!frame) return;
  ctx.drawImage(frame, 0, 0, 320, 180);
  const px = ctx.getImageData(0, 0, 320, 180).data;
  let v = 0;
  for (let k = 0; k < BITS; k++) {
    const { x, y } = CENTRES[k];
    if (px[(y * 320 + x) * 4] > 128) v += 2 ** k;
  }
  if (v === last) return;
  last = v;
  const now = (Date.now() + window.__offset) % MOD;
  window.__latencies.push(((now - v) % MOD + MOD) % MOD);
};
draw();
</script>`;

const frameLoopJs = async () => {
  const { transformWithEsbuild } = await import("vite");
  const file = path.join(
    import.meta.dirname,
    "../../app/features/video-editor/latest-frame.ts"
  );
  const { code } = await transformWithEsbuild(
    fs.readFileSync(file, "utf8"),
    file,
    { loader: "ts", format: "esm" }
  );
  return code;
};

export type LatencyStats = {
  frames: number;
  medianMs: number;
  p90Ms: number;
  p95Ms: number;
  maxMs: number;
};

export const latencyStats = (xs: number[]): LatencyStats | null => {
  // A misread clock reads as minutes or hours late: not a latency.
  const s = xs.filter((x) => x < 5000).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const at = (q: number) =>
    s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return {
    frames: s.length,
    medianMs: at(0.5),
    p90Ms: at(0.9),
    p95Ms: at(0.95),
    maxMs: s[s.length - 1]!,
  };
};

export type PreviewProbe = {
  /** Clears what was read so far; the next `read` covers from now. */
  reset: (feed: PreviewFeed, windowsOffsetMs: number) => Promise<void>;
  read: (feed: PreviewFeed) => Promise<LatencyStats | null>;
  close: () => Promise<void>;
};

/** One tab per feed, drawing for as long as the probe is open. */
export const openPreviewProbe = async (
  servicePort: number
): Promise<PreviewProbe> => {
  const js = await frameLoopJs();
  const server = http.createServer((req, res) => {
    const feed = (["camera", "screen"] as const).find(
      (f) => req.url === `/${f}`
    );
    if (feed) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(page(feed));
      return;
    }
    if (req.url === "/frame-loop.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(js);
      return;
    }
    const upstream = http.get(
      { host: "127.0.0.1", port: servicePort, path: req.url },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      }
    );
    upstream.on("error", () => res.destroy());
    res.on("close", () => upstream.destroy());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const browser: Browser = await chromium.launch();
  const tabs = {} as Record<PreviewFeed, Page>;
  for (const feed of ["camera", "screen"] as const) {
    tabs[feed] = await browser.newPage();
    await tabs[feed].goto(`http://127.0.0.1:${port}/${feed}`, {
      waitUntil: "commit",
    });
  }
  return {
    reset: async (feed, offset) => {
      await tabs[feed].evaluate((o) => {
        const w = window as unknown as {
          __latencies: number[];
          __offset: number;
        };
        w.__offset = o;
        w.__latencies = [];
      }, offset);
    },
    read: async (feed) =>
      latencyStats(
        await tabs[feed].evaluate(
          () => (window as unknown as { __latencies: number[] }).__latencies
        )
      ),
    close: async () => {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
};
