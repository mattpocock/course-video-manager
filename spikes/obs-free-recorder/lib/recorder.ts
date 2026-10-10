// Builds and runs the recorder: two ffmpeg.exe processes writing three files.
//   screen process:        ddagrab -> screen.mkv
//   camera + mic process:  Cam Link -> camera.mkv (+ 640x360 MJPEG preview), mic -> mic.mkv
// Screen and camera were one process at first, but any second GPU stream in the
// same process (camera upload, scale or NVENC) made ddagrab miss frames: 55-58
// fps with 40 ms+ gaps in testing, against 59.7-59.8 fps when split.
//
// One shared clock across both processes, in four steps:
//  1. Every input is stamped with -use_wallclock_as_timestamps 1: each frame or
//     audio packet gets the Windows system time at the moment ffmpeg reads it.
//  2. -copyts stops ffmpeg from zeroing each input separately (which would
//     throw away the offset between them).
//  3. setpts/asetpts subtract T0, one constant shared by every stream. File
//     time t therefore means Windows wall time T0 + t in all three files, and
//     in the preview page (Chrome's Date.now() reads the same clock).
//  4. fps=…:start_time=0 and aresample=…:first_pts=0 make each file CFR and
//     start at exactly t=0. When a device clock runs fast or slow against the
//     system clock, fps drops or duplicates a frame and aresample stretches the
//     audio by a few samples, as OBS does.
//
// Per-frame arrival times (before the CFR step) go to *-arrivals.txt, so the
// analysis can tell real capture drops from clock corrections.
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { SYSTEM32, toWindowsPath, windowsTool } from "./win.ts";

export type Synthetic = {
  /** Camera clock speed vs the system clock (1.0003 = +300 ppm). */
  camSpeed: number;
  micSpeed: number;
  /** Seconds between wall-clock-aligned flash/beep markers. */
  period: number;
  /**
   * Capture the real screen with ddagrab instead of a test pattern. A small
   * marker square on that screen flashes on the same wall-clock boundaries.
   */
  realScreen: boolean;
  /** Negative control: skip aresample's drift correction. */
  noAudioCorrection: boolean;
};

export type RecorderOptions = {
  t0Ms: number;
  tag: string;
  screenIdx: number;
  camera?: string;
  mic?: string;
  synthetic?: Synthetic;
  previewPorts: { screen: number; camera: number };
};

export const FILES = {
  screen: "screen.mkv",
  camera: "camera.mkv",
  mic: "mic.mkv",
  screenArrivals: "screen-arrivals.txt",
  cameraArrivals: "camera-arrivals.txt",
};

const BT709 =
  "setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709";

// Matches OBS "Landscape Recording": NVENC H.264, CQP 23, P5 + hq, High, 2 B-frames.
// GOP is fixed at 2 s so a crash loses at most one GOP.
const NVENC = (gop: number) => [
  "-c:v",
  "h264_nvenc",
  "-preset",
  "p5",
  "-tune",
  "hq",
  "-rc",
  "constqp",
  "-qp",
  "23",
  "-profile:v",
  "high",
  "-bf",
  "2",
  "-g",
  String(gop),
  "-fps_mode",
  "passthrough",
];

// MKV, like OBS today: playable up to the last flushed cluster after a crash,
// and it stores PTS directly, so B-frame delay and AAC priming don't shift the
// start time (fragmented MP4 put the first video frame 2 frames late).
// A cluster is held in memory until it closes, so the cluster time bounds what
// a hard kill loses: at 2 s the camera file lost 2.2 s once the kill time was
// read accurately, over the 2 s criterion. 1 s keeps it to about 1 s.
const MKV = [
  "-cluster_time_limit",
  "1000",
  "-flush_packets",
  "1",
  "-f",
  "matroska",
];

// A preview consumer that dies or stalls must never stop the recording, and a
// slow first connect must not lose the preview for the whole run. ffmpeg's tcp
// `timeout` is also its connect timeout, and Windows → WSL localhost connects
// sometimes take longer than the 0.5 s first used here (ETIMEDOUT, then the tee
// dropped the slave for good: "preview frames 0/0" in 3 of 26 runs). So the
// preview slave sits behind tee's fifo: its own thread and queue, packets
// dropped when the queue is full (the graph never waits on the reader), and the
// connection retried every 0.5 s for as long as the run lasts. The null slave
// keeps the tee alive.
export const preview = (port: number) => [
  "-c:v",
  "mjpeg",
  "-q:v",
  "7",
  "-f",
  "tee",
  "-use_fifo",
  "1",
  "-fifo_options",
  "attempt_recovery=1:recover_any_error=1:recovery_wait_time=0.5:max_recovery_attempts=0:drop_pkts_on_overflow=1:queue_size=30",
  `[f=mpjpeg:onfail=ignore]tcp://127.0.0.1:${port}?timeout=2000000|[f=null:use_fifo=0]-`,
];

// ---------- synthetic sources (selftest) ----------
// See synthetic-source.ps1 for why these are not ffmpeg lavfi sources.
export const SYNTH_PORTS = { screen: 4793, camera: 4794, mic: 4795 };
/** The real-screen marker square, in output pixels; the analysis crops to it. */
export const SCREEN_MARKER = { x: 16, y: 16, size: 64 };
export const SCREEN_MARKER_CROP = `${SCREEN_MARKER.size}:${SCREEN_MARKER.size}:${SCREEN_MARKER.x}:${SCREEN_MARKER.y}`;
const SYNTH_SCRIPT = path.join(import.meta.dirname, "synthetic-source.ps1");

/** Starts the Windows-side sources; resolves once all are listening (or showing). */
export async function startSyntheticSources(
  s: Synthetic,
  screenIdx: number,
  log: (name: string, line: string) => void
) {
  const ps = `${SYSTEM32}/WindowsPowerShell/v1.0/powershell.exe`;
  const script = toWindowsPath(SYNTH_SCRIPT);
  const common = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script];
  const specs: [string, string[]][] = [
    [
      "screen",
      [
        "-Kind",
        "video",
        "-Port",
        String(SYNTH_PORTS.screen),
        "-Width",
        "960",
        "-Height",
        "540",
        "-Fps",
        "60",
        "-Speed",
        "1",
        "-Period",
        String(s.period),
      ],
    ],
    [
      "camera",
      [
        "-Kind",
        "video",
        "-Port",
        String(SYNTH_PORTS.camera),
        "-Width",
        "3840",
        "-Height",
        "2160",
        "-Fps",
        String(30000 / 1001),
        "-Speed",
        String(s.camSpeed),
        "-Period",
        String(s.period),
      ],
    ],
    [
      "mic",
      [
        "-Kind",
        "audio",
        "-Port",
        String(SYNTH_PORTS.mic),
        "-Speed",
        String(s.micSpeed),
        "-Period",
        String(s.period),
      ],
    ],
    [
      "marker",
      [
        "-Kind",
        "marker",
        "-Output",
        String(screenIdx),
        "-X",
        String(SCREEN_MARKER.x),
        "-Y",
        String(SCREEN_MARKER.y),
        "-Size",
        String(SCREEN_MARKER.size),
        "-Period",
        String(s.period),
      ],
    ],
  ];
  const children = specs
    .filter(([name]) => (s.realScreen ? name !== "screen" : name !== "marker"))
    .map(([name, args]) => {
      const child = spawn(ps, [...common, ...args], {
        cwd: "/mnt/c",
        stdio: ["ignore", "pipe", "pipe"],
      });
      process.once("exit", () => child.exitCode === null && child.kill());
      child.stderr!.on("data", (d) => log(name, String(d)));
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout!.on("data", (d) => {
          log(name, String(d));
          if (String(d).includes("listening")) resolve();
        });
        child.once("exit", (code) =>
          reject(new Error(`synthetic ${name} source exited (${code})`))
        );
      });
      return { child, ready };
    });
  await Promise.all(children.map((c) => c.ready));
  return children.map((c) => c.child);
}

export type RecorderArgs = { screen: string[]; camera: string[] };

export function buildArgs(o: RecorderOptions): RecorderArgs {
  const t0 = (o.t0Ms / 1000).toFixed(3);
  const s = o.synthetic;
  const wall = [
    "-use_wallclock_as_timestamps",
    "1",
    "-thread_queue_size",
    "512",
  ];
  const head = [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "level+info",
    "-y",
    "-progress",
    "pipe:1",
    "-stats_period",
    "1",
    "-copyts",
  ];
  // -framerate only sets the demuxer's time base here; 1000 keeps the wallclock
  // stamp at 1 ms precision instead of rounding it to the frame grid.
  const rawVideoIn = (port: number, size: string) => [
    "-f",
    "rawvideo",
    "-pixel_format",
    "nv12",
    "-video_size",
    size,
    "-framerate",
    "1000",
    "-i",
    `tcp://127.0.0.1:${port}`,
  ];
  // direct=1: unbuffered, so the stamps survive a hard kill too.
  const arrivals = (file: string) =>
    `metadata=mode=add:key=rig:value=1,metadata=mode=print:direct=1:file=${file}`;

  // ---- screen process ----
  const synthScreen = !!s && !s.realScreen;
  const screenIn = synthScreen
    ? [...wall, ...rawVideoIn(SYNTH_PORTS.screen, "960x540")]
    : // dup_frames=1 is required: with dup_frames=0 ddagrab emits nothing at all
      // while the screen is static, which stalls the graph. Known cost: ffmpeg
      // paces ddagrab with Sleep(), which ticks at 15.6 ms on Windows (ffmpeg
      // never calls timeBeginPeriod), so captures land on that grid, up to
      // ~15 ms after the frame was presented. See RUN.md, "Risks".
      [
        ...wall,
        "-f",
        "lavfi",
        "-i",
        `ddagrab=output_idx=${o.screenIdx}:framerate=60:dup_frames=1:draw_mouse=1,settb=AVTB`,
      ];
  // The synthetic screen arrives as 960x540 NV12 and goes into a 1920x1080 D3D11
  // texture on the GPU, standing in for ddagrab's D3D11 BGRA texture.
  const upload = synthScreen
    ? "hwupload,scale_d3d11=1920:1080:format=nv12,"
    : "";
  const screenGraph = [
    `[0:v]setpts=PTS-${t0}/TB,${arrivals(FILES.screenArrivals)},fps=60:start_time=0,${BT709},${upload}` +
      (synthScreen
        ? "scale_d3d11=format=nv12,split[scr][scrp]"
        : "scale_d3d11=format=nv12[scr]"),
    // Real screen: no preview branch in the recorder. Reading a D3D11 frame back
    // to the CPU in this graph stalled capture (58 fps in testing); the screen
    // preview is its own ffmpeg.exe (startScreenPreview).
    ...(synthScreen
      ? [
          "[scrp]fps=30,scale_d3d11=960:540:format=nv12,hwdownload,format=nv12,format=yuvj420p[scrprev]",
        ]
      : []),
  ].join(";");
  const screen = [
    ...head,
    ...(synthScreen
      ? ["-init_hw_device", "d3d11va=d3d", "-filter_hw_device", "d3d"]
      : []),
    ...screenIn,
    "-filter_complex",
    screenGraph,
    "-map",
    "[scr]",
    ...NVENC(120),
    "-metadata",
    `comment=${o.tag}`,
    ...MKV,
    FILES.screen,
    ...(synthScreen
      ? ["-map", "[scrprev]", ...preview(o.previewPorts.screen)]
      : []),
  ];

  // ---- camera + mic process ----
  // Cam Link 4K only offers 2160p29.97 or 1080p59.94 raw, so open 4K NV12 and
  // scale to 1440p on the GPU.
  const cameraIn = s
    ? [...wall, ...rawVideoIn(SYNTH_PORTS.camera, "3840x2160")]
    : [
        ...wall,
        "-f",
        "dshow",
        "-rtbufsize",
        "1500M",
        "-video_size",
        "3840x2160",
        "-framerate",
        "30000/1001",
        "-pixel_format",
        "nv12",
        "-i",
        `video=${o.camera}`,
      ];
  // Mic, raw (no filters). A 20 ms device buffer keeps the wallclock stamp close to capture.
  const micIn = s
    ? [
        ...wall,
        "-f",
        "s16le",
        "-sample_rate",
        "48000",
        "-ch_layout",
        "stereo",
        "-i",
        `tcp://127.0.0.1:${SYNTH_PORTS.mic}`,
      ]
    : [
        ...wall,
        "-f",
        "dshow",
        "-audio_buffer_size",
        "20",
        "-sample_rate",
        "48000",
        "-channels",
        "2",
        "-i",
        `audio=${o.mic}`,
      ];
  // Audio packets that queued while ffmpeg was still opening the camera arrive
  // in one burst, all stamped "now". Dropping the first 1.5 s (padded back with
  // silence by first_pts=0) keeps that burst from becoming an initial offset.
  // async=50 then stretches/squeezes up to 50 samples/s (~1000 ppm) to follow
  // the system clock; jumps over 100 ms are filled/trimmed at once.
  const audioSync = s?.noAudioCorrection
    ? "atrim=start=1.5,aresample=first_pts=0"
    : "atrim=start=1.5,aresample=async=50:min_hard_comp=0.1:first_pts=0";
  const cameraGraph = [
    `[0:v]setpts=PTS-${t0}/TB,${arrivals(FILES.cameraArrivals)},fps=30000/1001:start_time=0,${BT709},` +
      "hwupload_cuda,scale_cuda=2560:1440:interp_algo=bicubic,split[cam][camp]",
    "[camp]scale_cuda=640:360,hwdownload,format=nv12,format=yuvj420p[camprev]",
    `[1:a]asetpts=PTS-${t0}/TB,${audioSync}[mic]`,
  ].join(";");
  const camera = [
    ...head,
    ...cameraIn,
    ...micIn,
    "-filter_complex",
    cameraGraph,
    "-map",
    "[cam]",
    ...NVENC(60),
    "-metadata",
    `comment=${o.tag}`,
    ...MKV,
    FILES.camera,
    "-map",
    "[mic]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    ...MKV,
    FILES.mic,
    "-map",
    "[camprev]",
    ...preview(o.previewPorts.camera),
  ];
  return { screen, camera };
}

export type Progress = Record<string, string>;

export function startRecorder(
  runDir: string,
  args: string[],
  onProgress: (p: Progress) => void,
  onLog: (chunk: string) => void
): ChildProcess {
  const child = spawn(windowsTool("ffmpeg"), args, {
    cwd: runDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let block: Progress = {};
  let buf = "";
  child.stdout!.on("data", (d: Buffer) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      block[line.slice(0, eq)] = line.slice(eq + 1);
      if (line.startsWith("progress=")) {
        onProgress(block);
        block = {};
      }
    }
  });
  child.stderr!.on("data", (d: Buffer) => onLog(d.toString()));
  return child;
}

/**
 * Screen preview for real capture: a second, independent Desktop Duplication
 * session (Windows allows several) in its own ffmpeg.exe. It can stall, crash
 * or be killed without touching the recorder.
 */
export function startScreenPreview(
  screenIdx: number,
  port: number,
  onLog: (chunk: string) => void
): ChildProcess {
  const child = spawn(
    windowsTool("ffmpeg"),
    [
      "-hide_banner",
      "-nostats",
      "-loglevel",
      "level+warning",
      "-f",
      "lavfi",
      "-i",
      `ddagrab=output_idx=${screenIdx}:framerate=30,hwdownload,format=bgra,scale=960:540,format=yuvj420p`,
      "-map",
      "0:v",
      ...preview(port),
    ],
    { cwd: "/mnt/c", stdio: ["pipe", "ignore", "pipe"] }
  );
  child.stderr!.on("data", (d: Buffer) => onLog(d.toString()));
  return child;
}

/** Graceful stop: 'q' on stdin, like pressing q in an ffmpeg console; force-kill after 20 s. */
export function stopRecorder(
  child: ChildProcess,
  forceKill: () => void
): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(forceKill, 20_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.stdin!.write("q");
  });
}
