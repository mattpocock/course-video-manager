import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { previewPath, type PreviewFeed } from "../../recorder-service/protocol";
import {
  CLOCK_BITS,
  CLOCK_HEIGHT,
  CLOCK_SHARE,
  CLOCK_WIDTH,
  clockBitCentre,
} from "./synthetic-sources";

/**
 * PREVIEW LATENCY as the editor sees it: a headless Chromium decodes the
 * service's preview feed with the editor's own frame loop
 * (`latest-frame.ts`, WebCodecs) and reads each frame's burned-in Windows
 * time back. Latency = Windows time at the first animation frame that has
 * the decoded frame to draw, less the time burned into it. The page reads
 * WSL's clock, so the Windows-WSL offset is handed in (`windowsClockOffset`).
 *
 * The clock is read from the decoded frame's own planes (`VideoFrame.copyTo`
 * of the clock's rows), never by drawing it (#2440). A `drawImage` of the 4K
 * camera frame into a software canvas cost the probe ~31 ms a frame, so the
 * tail it reported tracked the machine's load, not the recorder.
 *
 * The page is served from a port of the scorecard's own, which proxies the
 * feed: the service only answers CVM's own page origins.
 */

const page = (feed: PreviewFeed) => `<!doctype html>
<script type="module">
const BITS = ${CLOCK_BITS};
const CENTRES = ${JSON.stringify(Array.from({ length: CLOCK_BITS }, (_, k) => clockBitCentre(k)))};
const W = ${CLOCK_WIDTH}, H = ${CLOCK_HEIGHT};
/** The clock's rows end above this share of the frame's height. */
const CLOCK_SHARE = ${CLOCK_SHARE};
const MOD = 2 ** BITS;
const { watchLatestFrame } = await import("/frame-loop.js");
let frame;
let fresh = false;
watchLatestFrame("${previewPath(feed)}", (f) => { frame?.close(); frame = f; fresh = true; });
window.__offset = 0;
window.__latencies = [];
let last = -1;
/** The clock's bits, read from the decoded frame's own planes (no canvas). */
const readClock = async (f) => {
  const vr = f.visibleRect;
  const rect = {
    x: vr.x,
    y: vr.y,
    width: vr.width,
    height: Math.min(vr.height, 2 * Math.ceil((vr.height * CLOCK_SHARE) / 2)),
  };
  const buf = new Uint8Array(f.allocationSize({ rect }));
  const [plane] = await f.copyTo(buf, { rect });
  const rgb = /^(RGB|BGR)/.test(f.format ?? "");
  let v = 0;
  for (let k = 0; k < BITS; k++) {
    const x = Math.floor((CENTRES[k].x * vr.width) / W);
    const y = Math.floor((CENTRES[k].y * vr.height) / H);
    const at = plane.offset + y * plane.stride + (rgb ? x * 4 + 1 : x);
    if (buf[at] > 128) v += 2 ** k;
  }
  return v;
};
const tick = () => {
  requestAnimationFrame(tick);
  if (!frame || !fresh) return;
  fresh = false;
  // The animation frame that first has this frame to draw: when the
  // editor's composite would draw it.
  const drawnAt = Date.now() + window.__offset;
  const f = frame.clone();
  readClock(f)
    .then((v) => {
      if (v === last) return;
      last = v;
      window.__latencies.push((((drawnAt % MOD) - v) % MOD + MOD) % MOD);
    })
    .catch(() => {})
    .finally(() => f.close());
};
tick();
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

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * A preview latency over many short windows: the median of each window's
 * median and of each window's p95 (#2675). One 10 s window's p95 swung
 * 365–1249 ms from run to run on the same code, because one burst of machine
 * load lands in it or not. The median window is the recorder's usual tail; a
 * burst moves one window, not the median.
 */
export type WindowedLatency = {
  windows: number;
  windowMs: number;
  frames: number;
  /** Median of the windows' medians. */
  medianMs: number;
  /** Median of the windows' p95s. */
  p95Ms: number;
  /** The windows' p95s, lowest and highest: the spread inside the run. */
  p95RangeMs: [number, number];
  /** Every window's p95, in order. */
  windowP95sMs: number[];
  /** Every window's frames pooled, as one window: for reference only. */
  pooled: LatencyStats | null;
};

export const windowedLatency = (
  windows: (number[] | null)[],
  windowMs: number
): WindowedLatency | null => {
  const stats = windows
    .map((w) => (w ? latencyStats(w) : null))
    .filter((s): s is LatencyStats => s !== null);
  if (stats.length === 0) return null;
  const p95s = stats.map((s) => s.p95Ms);
  return {
    windows: stats.length,
    windowMs,
    frames: stats.reduce((n, s) => n + s.frames, 0),
    medianMs: median(stats.map((s) => s.medianMs)),
    p95Ms: median(p95s),
    p95RangeMs: [Math.min(...p95s), Math.max(...p95s)],
    windowP95sMs: p95s,
    pooled: latencyStats(windows.flatMap((w) => w ?? [])),
  };
};

export type PreviewProbe = {
  /** Clears what was read so far; the next `read` covers from now. */
  reset: (feed: PreviewFeed, windowsOffsetMs: number) => Promise<void>;
  /** Every latency read since the last `reset`, in ms, in the order drawn. */
  read: (feed: PreviewFeed) => Promise<number[]>;
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
      tabs[feed].evaluate(
        () => (window as unknown as { __latencies: number[] }).__latencies
      ),
    close: async () => {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
};
