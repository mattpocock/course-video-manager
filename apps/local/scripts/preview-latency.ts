/**
 * Preview latency: how far behind the moment a frame was made the recorder's
 * live preview shows it in a browser (#2144, #2192).
 *
 *   pnpm --filter @cvm/local preview-latency [--scenario camera|camera-cpu|screen|screen-square|recording|floor|all]
 *     [--seconds 10] [--encoder nvenc|x264]
 *
 * Synthetic sources only: no capture device, no screen. Each scenario takes
 * the real ffmpeg.exe arguments (`capture-args.ts`) and swaps the device
 * input for a synthetic one of the same size and rate with the time it was
 * made burned in (`sourceArgs`). ffmpeg.exe then sends the preview through
 * the real tee to the real preview feeds (`preview-feeds.ts`), and a
 * headless Chromium decodes it (`latest-frame.ts`, WebCodecs) and draws it as
 * the editor's composite does, reading the time back each animation frame:
 * latency = when a frame is first drawn less the time burned into it.
 *
 *   camera     the camera capture (`cameraCaptureArgs`, 4K NV12 in) and its
 *              preview process (`cameraPreviewArgs`), with no take
 *   camera-cpu the camera preview's encode at its size (1440p, 29.97 fps)
 *              without the CUDA scale: the camera's cost with no GPU
 *   screen     the screen preview process (`screenPreviewArgs`), the
 *              DELL's 1080p BGRA in at 60 fps, previewed unscaled
 *   screen-square  the same for a Short's 1080x1080 Spacedesk display
 *              (ADR 0043)
 *   recording  the same, with a take's armed writer (`cameraWriterArgs`)
 *              started (`takeStartCommand`) as measuring starts: it writes
 *              camera.mkv and mic.mkv to a temporary folder, deleted after.
 *              The preview is the same process either way (#2207), so this
 *              should read as `camera` does
 *   floor      a 640x360 source straight to the preview output: what any
 *              frame costs (the pipe in, encode, tee, TCP, browser), for
 *              reading the others against
 *
 * The previews encode on NVENC unless `--encoder x264` (#2194); the camera
 * and recording scenarios use CUDA either way.
 *
 * Every ffmpeg.exe starts through the Windows guard (`windows-guard.ts`): it
 * refuses while the recorder or OBS is running, and runs each one at Idle
 * priority on cores 6-9, so latencies here read higher than the recorder's.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { pickRelays } from "../recorder-service/camera";
import {
  cameraCaptureArgs,
  cameraPreviewArgs,
  previewOutput,
  screenPreviewArgs,
  SCREEN_PREVIEW_CHAIN,
  type PreviewEncoder,
} from "../recorder-service/capture-args";
import {
  cameraWriterArgs,
  takeStartCommand,
} from "../recorder-service/take-args";
import { startPreviewFeeds } from "../recorder-service/preview-feeds";
import { findFfmpegExe } from "../recorder-service/windows-launcher";
import { guardWindows } from "./windows-guard";
import { log } from "@/packages/log";
import { after, delay, nowMs } from "@/packages/clock";

const SCENARIOS = [
  "floor",
  "camera",
  "camera-cpu",
  "screen",
  "screen-square",
  "recording",
] as const;

/** Each screen scenario's synthetic screen, at its device's size. */
const SCREENS = {
  screen: { width: 1920, height: 1080 },
  "screen-square": { width: 1080, height: 1080 },
} as const;
const isScreen = (s: Scenario): s is keyof typeof SCREENS => s in SCREENS;
type Scenario = (typeof SCENARIOS)[number];

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const scenarioFlag = flag("--scenario", "all");
const seconds = Number(flag("--seconds", "10"));
const encoder = flag("--encoder", "nvenc") as PreviewEncoder;
const WARMUP_SECONDS = 3;

/**
 * The synthetic camera or screen: Linux ffmpeg in WSL draws 28 bits of the
 * WSL wall clock in ms (a 7x4 grid of 40 px blocks) into a 320x180 frame,
 * and pipes it raw into ffmpeg.exe in place of the device; ffmpeg.exe scales
 * it up to the device's size with no smoothing. The browser reads the clock
 * back in WSL too, so one clock is on both ends (the Windows and WSL clocks
 * can be 100 ms apart, and wander). Frame n is stamped with the time it is
 * due (first frame + n / rate), not the time it gets made: like a capture
 * device, a frame the pipeline is late to take has been waiting, and that
 * wait is latency.
 */
const BITS = 28;
const sourceArgs = (rate: string) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  `color=c=black:s=320x180:r=${rate},settb=AVTB,` +
    "setpts='if(eq(N\\,0)\\,st(0\\,RTCTIME-PTS)\\,0);PTS+ld(0)',realtime," +
    "geq=lum='if(between(X\\,20\\,299)*between(Y\\,10\\,169)\\," +
    "255*mod(floor(floor(T*1000)/pow(2\\,floor((X-20)/40)+7*floor((Y-10)/40)))\\,2)\\,0)'" +
    ":cb=128:cr=128",
  "-f",
  "rawvideo",
  "-pix_fmt",
  "yuv420p",
  "pipe:1",
];

/** ffmpeg.exe's side of the pipe. */
const pipedInput = (rate: string) => [
  "-f",
  "rawvideo",
  "-pix_fmt",
  "yuv420p",
  "-video_size",
  "320x180",
  "-framerate",
  rate,
  "-i",
  "pipe:0",
];

/** Scales the piped source up to a device's size and format. */
const upscale = (size: string, format: string) =>
  `scale=${size.replace("x", ":")}:flags=neighbor,format=${format}`;

const CAMERA_RATE = "30000/1001";

/**
 * The piped source made the Cam Link's 4K NV12. On the GPU and back, not
 * swscale: a 4K CPU scale costs about as long as a frame lasts, so ffmpeg.exe
 * could never catch up on a backlog the way it does reading the real device.
 */
const TO_4K =
  "format=nv12,hwupload_cuda,scale_cuda=3840:2160:interp_algo=nearest,hwdownload,format=nv12";

/** The piped source made the Cam Link's 4K on the GPU, for a graph that uploads it anyway. */
const ON_GPU_4K = "scale_cuda=3840:2160:interp_algo=nearest";

const SYNTH_MIC =
  "sine=f=440:sample_rate=48000:samples_per_frame=960,arealtime,aformat=channel_layouts=stereo";

/**
 * Swaps each DirectShow input (`-f dshow … -i video=…|audio=…`) for a
 * synthetic one: the camera piped in and scaled up to 4K NV12 at the head of
 * each filter graph that reads it, the mic a lavfi tone.
 */
const withoutDevices = (argv: readonly string[]) => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-f" && argv[i + 1] === "dshow") {
      let j = i;
      while (argv[j] !== "-i") j++;
      const device = argv[j + 1] ?? "";
      out.push(
        ...(device.startsWith("video=")
          ? pipedInput(CAMERA_RATE)
          : ["-f", "lavfi", "-i", SYNTH_MIC])
      );
      i = j + 1;
      continue;
    }
    if (argv[i - 1] === "-vf") {
      out.push(`${TO_4K},${argv[i]}`);
      continue;
    }
    if (argv[i - 1] === "-filter_complex") {
      // A graph that uploads the Cam Link's frame gets the source's 4K
      // there, on the GPU: one upload, as the real device's frame has.
      out.push(
        argv[i]!.includes("[0:v]hwupload_cuda,")
          ? argv[i]!.replace(
              "[0:v]hwupload_cuda,",
              `[0:v]format=nv12,hwupload_cuda,${ON_GPU_4K},`
            )
          : `[0:v]${TO_4K}[synth];` + argv[i]!.replaceAll("[0:v]", "[synth]")
      );
      continue;
    }
    out.push(argv[i]!);
  }
  return out;
};

/**
 * The ffmpeg.exe processes of a scenario, consumers first (they listen for
 * the capture's relays); the one reading `pipe:0` gets the synthetic source.
 * `writer`: the index of a take's armed writer, started once measuring does.
 */
const ffmpegProcesses = (
  scenario: Scenario,
  port: number,
  stillPort: number
): { processes: string[][]; writer?: number } => {
  if (scenario === "camera" || scenario === "recording") {
    const relays = pickRelays();
    const preview = cameraPreviewArgs({
      relayPort: relays.preview,
      port,
      stillPort,
      encoder,
    });
    const capture = withoutDevices(
      cameraCaptureArgs({ camera: "synthetic", mic: "synthetic", relays })
    );
    if (scenario === "camera") return { processes: [preview, capture] };
    const writer = cameraWriterArgs({
      relayPort: relays.writer,
      tag: "cvm-preview-latency",
      silenceLength: "short",
      thresholdDb: -40,
    });
    return { processes: [preview, writer, capture], writer: 1 };
  }
  return { processes: [ffmpegArgs(scenario, port)] };
};

const ffmpegArgs = (
  scenario: Exclude<Scenario, "camera" | "recording">,
  port: number
): string[] => {
  switch (scenario) {
    case "floor":
      return [
        "-hide_banner",
        "-loglevel",
        "warning",
        ...pipedInput(CAMERA_RATE),
        "-vf",
        upscale("640x360", "yuv420p"),
        "-map",
        "0:v",
        ...previewOutput(port, 30, encoder),
      ];
    case "camera-cpu":
      return [
        "-hide_banner",
        "-loglevel",
        "warning",
        ...pipedInput(CAMERA_RATE),
        "-vf",
        upscale("2560x1440", "yuv420p"),
        "-map",
        "0:v",
        ...previewOutput(port, 30, encoder),
      ];
    case "screen":
    case "screen-square": {
      // ddagrab's lavfi input becomes the pipe, stretched to the screen's
      // shape and size: the preview sends it unscaled, so the browser still
      // reads the 320x180 clock whole once it scales it back.
      const size = SCREENS[scenario];
      const argv = screenPreviewArgs({ screenIndex: 0, port, encoder });
      // For NVENC the BGRA goes up to the GPU as D3D11, as ddagrab gives
      // it, and through the preview's own chain there.
      const at = argv.findIndex((a) => a.startsWith("ddagrab="));
      const rate = argv[at]!.match(/framerate=(\d+)/)?.[1] ?? "60";
      const bgra = upscale(`${size.width}x${size.height}`, "bgra");
      const d3d11 = encoder === "nvenc";
      return [
        ...argv.slice(0, at - 3),
        ...(d3d11
          ? ["-init_hw_device", "d3d11va=d3d", "-filter_hw_device", "d3d"]
          : []),
        ...pipedInput(rate),
        "-vf",
        d3d11 ? `${bgra},hwupload,${SCREEN_PREVIEW_CHAIN.nvenc}` : bgra,
        ...argv.slice(at + 1),
      ];
    }
  }
};

const page = (o: { feed: string }) => `<!doctype html>
<canvas id="c" width="320" height="180"></canvas>
<script type="module">
const BITS = ${BITS};
const MOD = 2 ** BITS;
const ctx = document.getElementById("c").getContext("2d", { willReadFrequently: true });
const { watchLatestFrame } = await import("/frame-loop.js");
let frame;
watchLatestFrame("/preview/${o.feed}", (f) => { frame?.close(); frame = f; });
const current = () => frame;
window.__latencies = [];
let last = -1;
const draw = () => {
  requestAnimationFrame(draw);
  const src = current();
  if (!src) return;
  ctx.drawImage(src, 0, 0, 320, 180);
  const px = ctx.getImageData(0, 0, 320, 180).data;
  let v = 0;
  for (let k = 0; k < BITS; k++) {
    const x = 20 + (k % 7) * 40 + 20, y = 10 + Math.floor(k / 7) * 40 + 20;
    if (px[(y * 320 + x) * 4] > 128) v += 2 ** k;
  }
  if (v === last) return;
  last = v;
  const now = Date.now() % MOD;
  window.__latencies.push(((now - v) % MOD + MOD) % MOD);
};
draw();
</script>`;

const frameLoopJs = async () => {
  const { transformWithEsbuild } = await import("vite");
  const file = path.join(
    import.meta.dirname,
    "../app/features/video-editor/latest-frame.ts"
  );
  const { code } = await transformWithEsbuild(
    fs.readFileSync(file, "utf8"),
    file,
    { loader: "ts", format: "esm" }
  );
  return code;
};

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    frames: s.length,
    fps: Number((s.length / seconds).toFixed(1)),
    medianMs: at(0.5),
    p90Ms: at(0.9),
    maxMs: s[s.length - 1],
  };
};

const measure = async (scenario: Scenario) => {
  const exe = findFfmpegExe();
  if (!exe) throw new Error("ffmpeg.exe not found");
  const feeds = await startPreviewFeeds();
  const js = await frameLoopJs();
  const feed = isScreen(scenario) ? "screen" : "camera";
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(page({ feed }));
      return;
    }
    if (req.url === "/frame-loop.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(js);
      return;
    }
    if (!feeds.serve(req, res, {})) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const httpPort = (server.address() as { port: number }).port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-latency-"));
  const { processes, writer } = ffmpegProcesses(
    scenario,
    feeds.port(feed),
    feeds.port("still")
  );
  let log = "";
  const ffs = processes.map((argv) => {
    const p = windows.spawn(exe, argv, {
      cwd: dir,
      stdio: ["pipe", "ignore", "pipe"],
    });
    p.stderr?.on(
      "data",
      (d: Buffer) => (log = (log + d.toString()).slice(-4000))
    );
    p.stdin?.on("error", () => {});
    return p;
  });
  const ff = ffs[processes.findIndex((a) => a.includes("pipe:0"))]!;
  const ffClosed = Promise.all(
    ffs.map((p) => new Promise<void>((r) => p.once("close", () => r())))
  );
  const source = spawn(
    "ffmpeg",
    sourceArgs(isScreen(scenario) ? "60" : CAMERA_RATE),
    { stdio: ["ignore", "pipe", "inherit"] }
  );
  source.stdout.pipe(ff.stdin!);

  // How many frames the service relays while measuring.
  let measuring = false;
  let relayed = 0;
  const unsubscribe = feeds.onFrame(feed, () => {
    if (measuring) relayed += 1;
  });

  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    await tab.goto(`http://127.0.0.1:${httpPort}/`, { waitUntil: "commit" });
    await delay(WARMUP_SECONDS * 1000);
    await tab.evaluate(() => {
      (window as unknown as { __latencies: number[] }).__latencies = [];
    });
    // A take starts as measuring does: T0 now, on the WSL clock (as
    // Windows' would be, give or take).
    if (writer !== undefined)
      ffs[writer]!.stdin?.write(takeStartCommand(nowMs()));
    measuring = true;
    await delay(seconds * 1000);
    measuring = false;
    const latencies = await tab.evaluate(
      () => (window as unknown as { __latencies: number[] }).__latencies
    );
    if (latencies.length === 0)
      throw new Error(`${scenario}: no frames drawn. ffmpeg said:\n${log}`);
    return {
      ...stats(latencies),
      relayedFps: Number((relayed / seconds).toFixed(1)),
    };
  } finally {
    unsubscribe();
    await browser.close();
    // The source ending ends the capture's input, and so the capture; the
    // others are asked to quit.
    source.kill();
    for (const p of ffs) if (p !== ff) p.stdin?.write("q");
    const cancelKill = after(5000, () => ffs.forEach((p) => p.kill("SIGKILL")));
    await ffClosed;
    cancelKill();
    server.closeAllConnections();
    server.close();
    await feeds.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Before anything starts on Windows: refuses while the recorder or OBS runs.
const windows = guardWindows();

const chosen: readonly Scenario[] =
  scenarioFlag === "all" ? SCENARIOS : [scenarioFlag as Scenario];
const results: Record<string, Awaited<ReturnType<typeof measure>>> = {};
for (const scenario of chosen) {
  results[scenario] = await measure(scenario);
  log.error(scenario, JSON.stringify(results[scenario]));
}
console.table(results);
