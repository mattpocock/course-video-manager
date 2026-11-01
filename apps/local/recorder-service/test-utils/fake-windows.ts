import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { armedWriter } from "./fake-writer";
import { CAPTURE_TAG, PREVIEW_TAGS } from "../capture-args";
import { STREAM_TAG } from "../stream-args";
import { fakeCardServers, readCardFeed } from "./fake-card-server";
import type { Launch, LaunchedProcess, Launcher } from "../launcher";
import { flvHeader, flvVideoTag } from "./flv";

/**
 * A fake Footage file: `fakeFootage(12.5)` is a file ffmpeg reads as 12.5 s
 * long; `fakeFootage(12.5, { unfinished: true })` one cut off before ffmpeg
 * wrote its duration, which a stream-copy remux recovers as 12.5 s.
 */
export const fakeFootage = (
  seconds: number,
  o: { unfinished?: boolean } = {}
) => (o.unfinished ? `unfinished:${seconds}` : `${seconds}`);

const readFootage = (file: string) => {
  if (!fs.existsSync(file)) return undefined;
  const [kind, seconds] = fs.readFileSync(file, "utf8").split(":");
  return kind === "unfinished"
    ? { seconds: Number(seconds), unfinished: true }
    : { seconds: Number(kind), unfinished: false };
};

/** ffmpeg.exe -i <file>, with no output: what it says of the file. */
const probeAnswer = (file: string) => {
  const footage = readFootage(file);
  if (!footage)
    return {
      stderr: `${path.basename(file)}: No such file or directory\r\n`,
      code: 1,
    };
  const duration = footage.unfinished
    ? "N/A"
    : `00:00:${footage.seconds.toFixed(2).padStart(5, "0")}`;
  return {
    stderr: `Input #0, matroska,webm, from '${path.basename(file)}':\r\n  Duration: ${duration}, start: 0.000000, bitrate: N/A\r\nAt least one output file must be specified\r\n`,
    code: 1,
  };
};

/**
 * A scripted Windows for the recorder service's tests: the process launcher,
 * the one seam they fake. Its ffmpeg.exe answers -version and -list_devices,
 * and its recorders print what a test tells them to and quit on `q`. Its
 * camera preview processes behave as the test scripts each try at the Cam
 * Link (`CameraTry`); one that gets frames sends fake frames every 20 ms to
 * the service's preview feeds, as ffmpeg's flv and mpjpeg muxers would.
 * Nothing here opens a real device.
 */

/**
 * One try at opening the Cam Link: frames arrive, nothing arrives (the
 * Cam Link's start-up trouble), or another program holds it. `stuck` sends
 * nothing and never reads `q` (ffmpeg stuck opening its input), and killing
 * its WSL side leaves ffmpeg.exe running on Windows.
 */
export type CameraTry = "frames" | "silent" | "busy" | "stuck";

export type FakeProcess = LaunchedProcess & {
  launch: Launch;
  stdout(text: string): void;
  stderr(text: string): void;
  exit(code: number | null): void;
  /** False once it has exited. */
  readonly running: boolean;
  /** What it prints between `q` and exiting. */
  onQuit?: () => void;
  /** Hears whatever is written to its stdin. */
  onStdin?: (text: string) => void;
  /** A camera capture whose Cam Link sends frames. */
  sending?: boolean;
  /** A take writer that has had Record's T0. */
  begun?: boolean;
  /** Everything written to its stdin. */
  written: string;
  /** Ignores `q`, and a kill ends only its WSL side. */
  stuck?: boolean;
  /** A preview that stalled: still running, sending nothing. */
  frozen?: boolean;
  /** A card server that stalled: still running, answering nothing. */
  stalled?: boolean;
};

const fakeProcess = (launch: Launch): FakeProcess => {
  const out: ((c: string) => void)[] = [];
  const err: ((c: string) => void)[] = [];
  let resolveExit!: (code: number | null) => void;
  let running = true;
  const exited = new Promise<number | null>((r) => (resolveExit = r));
  const p: FakeProcess = {
    launch,
    onStdout: (l) => void out.push(l),
    onStderr: (l) => void err.push(l),
    written: "",
    writeStdin: (text) => {
      p.written += text;
      p.onStdin?.(text);
      // ffmpeg closes its files and exits 0 on `q`.
      if (text === "q" && !p.stuck) {
        setImmediate(() => {
          p.onQuit?.();
          p.exit(0);
        });
      }
    },
    exited,
    kill: () => (p.stuck ? resolveExit(null) : p.exit(null)),
    stdout: (t) => out.forEach((l) => l(t)),
    stderr: (t) => err.forEach((l) => l(t)),
    exit: (code) => {
      running = false;
      resolveExit(code);
    },
    get running() {
      return running;
    },
  };
  return p;
};

/** Answers a short-lived process on the next tick (or after `afterMs`), then exits it. */
const answer = (
  p: FakeProcess,
  o: { stdout?: string; stderr?: string; code?: number; afterMs?: number }
) => {
  const reply = () => {
    if (o.stdout) p.stdout(o.stdout);
    if (o.stderr) p.stderr(o.stderr);
    p.exit(o.code ?? 0);
  };
  if (o.afterMs) setTimeout(reply, o.afterMs);
  else setImmediate(reply);
  return p;
};

const DEVICE_LISTING = [
  '[in#0 @ 000001] "Cam Link 4K" (video)',
  '[in#0 @ 000001]   Alternative name "@device_pnp_\\\\?\\usb#vid_0fd9"',
  '[in#0 @ 000001] "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)" (audio)',
  "Error opening input file dummy.",
].join("\r\n");

/** One reading as ffmpeg 8's ebur128 logs it at `-loglevel level+info`. */
export const ebur128Line = (seconds: number, m: number, s: number) =>
  `[Parsed_ebur128_0 @ 000001d2] [info] t: ${seconds.toFixed(4)}   TARGET:-23 LUFS    M: ${m.toFixed(1)} S: ${s.toFixed(1)}     I: ${s.toFixed(1)} LUFS       LRA:   0.0 LU`;

/**
 * The end of an AV Calibration's analysis, as ffmpeg printed it for a real
 * file: the speech windows' Summary, then the whole take's with its true
 * peak (in that order, though the parser does not rely on it).
 */
const calibrationAnalysisStderr = (a: {
  noiseFloorDb: number | "-inf";
  speechLufs: number;
  truePeakDb: number;
}) =>
  [
    "[info] Input #0, wav, from 'mic.wav':",
    "[Parsed_ebur128_17 @ 000001899126b300] [info] Summary:",
    "",
    "  Integrated loudness:",
    `    I:         ${a.speechLufs.toFixed(1)} LUFS`,
    "    Threshold: -35.1 LUFS",
    "",
    "  Loudness range:",
    "    LRA:         1.4 LU",
    "[Parsed_ebur128_4 @ 000001899126b480] [info] Summary:",
    "",
    "  Integrated loudness:",
    "    I:          -1.8 LUFS",
    "    Threshold: -24.0 LUFS",
    "",
    "  Loudness range:",
    "    LRA:        11.8 LU",
    "",
    "  True peak:",
    `    Peak:       ${a.truePeakDb.toFixed(1)} dBFS`,
    "[Parsed_astats_2 @ 0000018990e32b00] [info] Overall",
    `[Parsed_astats_2 @ 0000018990e32b00] [info] RMS level dB: ${typeof a.noiseFloorDb === "number" ? a.noiseFloorDb.toFixed(6) : a.noiseFloorDb}`,
    "[out#0/null @ 0000018990e32280] [info] video:0KiB audio:5625KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown",
    "",
  ].join("\r\n");

/** What the camera preview process sends to the still feed (its second output). */
export const FAKE_STILL_JPEG = Buffer.from([0xff, 0xd8, 0x57, 0xff, 0xd9]);

/** The fake H.264 the preview feeds carry: opaque bytes, which the service relays as they are. */
export const FAKE_AVCC = Buffer.from([1, 0x42, 0xc0, 0x28, 0xff]);
export const fakePreviewFrame = (n: number) =>
  Buffer.from([0, 0, 0, 1, n & 0xff]);

/**
 * Sends frames to each feed in the args every 20 ms until exit, in the
 * format its tee output names: FLV (the config, then a frame each time, a
 * keyframe every fifth) to a preview feed, mpjpeg (`FAKE_STILL_JPEG`) to the
 * still feed.
 */
const sendFrames = (
  p: FakeProcess,
  args: readonly string[],
  source: () => boolean = () => true
) => {
  const outputs = [
    ...args.join(" ").matchAll(/\[f=(\w+)[^\]]*\]tcp:\/\/127\.0\.0\.1:(\d+)/g),
  ].map((m) => {
    const socket = net.connect(Number(m[2]), "127.0.0.1");
    socket.on("error", () => {});
    if (m[1] === "flv")
      socket.write(
        Buffer.concat([flvHeader(), flvVideoTag({ config: FAKE_AVCC })])
      );
    return { flv: m[1] === "flv", socket };
  });
  let n = 0;
  const timer = setInterval(() => {
    if (p.frozen || !source()) return;
    for (const { flv, socket } of outputs) {
      if (flv) {
        socket.write(
          flvVideoTag({ key: n % 5 === 0, data: fakePreviewFrame(n) })
        );
        continue;
      }
      socket.write(
        `--ffmpeg\r\nContent-Type: image/jpeg\r\nContent-length: ${FAKE_STILL_JPEG.length}\r\n\r\n`
      );
      socket.write(FAKE_STILL_JPEG);
      socket.write("\r\n");
    }
    n += 1;
  }, 20);
  void p.exited.then(() => {
    clearInterval(timer);
    outputs.forEach(({ socket }) => socket.destroy());
  });
};

/** What ffmpeg 8.0.1's h264_nvenc prints when every session is taken. */
const NVENC_BUSY_STDERR = [
  "[h264_nvenc @ 0001] [error] OpenEncodeSessionEx failed: out of memory (10): (no details)",
  "[h264_nvenc @ 0001] [error] No capable devices found",
  "[vost#0:0/h264_nvenc @ 0002] [error] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.",
  "",
].join("\r\n");

/** Whether a process writes `file`: as an output of its own, or a tee's slave (`recordedAndPreviewed`). */
export const writesFile = (args: readonly string[], file: string) =>
  args.some((a) => a === file || a.includes(`]${file}|`));

const isPreview = (l: Launch, input: string) =>
  l.tool === "ffmpeg" &&
  l.args.some((a) => a.includes("tcp://")) &&
  !l.args.some((a) => a.endsWith(".mkv") || a.includes(".mkv|")) &&
  l.args.some((a) => a.includes(input));

const tagged = (l: Launch, tag: string) =>
  l.tool === "ffmpeg" && l.args.includes(`comment=${tag}`);

/** The loopback ports a process sends a relay to, or listens on for one. */
const relayPorts = (args: readonly string[]) =>
  [
    ...args
      .join(" ")
      .matchAll(
        /(?:\[f=(?:matroska|rawvideo)[^\]]*\]|^|\s)tcp:\/\/127\.0\.0\.1:(\d+)\?(?:timeout|listen|tcp_nodelay)/g
      ),
  ].map((m) => Number(m[1]));

export const fakeWindows = (
  o: {
    ffmpegVersion?: string;
    driver?: string;
    /** Each try at the Cam Link in turn; every try after these gets frames. */
    cameraTries?: CameraTry[];
    /**
     * NVENC has no free session: every preview launched with h264_nvenc
     * exits at once saying so, as ffmpeg 8.0.1 does. Recordings are not
     * affected.
     */
    nvencBusy?: boolean;
    /** The recording's camera + mic process: its first frame comes at once, or never. */
    recordingCamera?: "frames" | "silent";
    /** When a take's writer's graph comes up (`fake-writer.ts`). */
    writerGraphMs?: number;
    /**
     * The Spacedesk display: its size, and whether it is listed before any
     * wake (default: asleep, 1920x1080). A wake lists it, or fails with
     * `wakeFails`.
     */
    spacedesk?: { width: number; height: number; awake?: boolean };
    wakeFails?: string;
    /**
     * timer-resolution.ps1 fails, printing this, on the ffmpeg.exe whose
     * `-Match` it is given (the capture's tag, `camera.mkv`, `screen.mkv`).
     */
    tuneFails?: Record<string, string>;
    /**
     * The Live Stream's ffmpeg.exe: `up` prints its banner at once (it is
     * listening for its feeds); `never` prints nothing and never quits on
     * `q`, as one stuck starting.
     */
    stream?: "up" | "never";
    /** How long screens.ps1 takes to answer (PowerShell's start-up); default the next tick. */
    screensListingMs?: number;
    /** The Live Stream reads its card feed this far behind, at 60 fps (`readCardFeed`). */
    cardReadBehindMs?: number;
    /** `fakeCardServers`. */
    hungCardServers?: number;
    /** The DELL as screens.ps1 lists it (default 1920x1080); null: not plugged in. */
    dell?: { width: number; height: number } | null;
    /**
     * A synthetic mic for the level meter: its short-term loudness (LUFS) at
     * each second, printed as ebur128 would every 100 ms. Absent, the meter
     * prints only what a test tells it to.
     */
    micLoudness?: (seconds: number) => number;
    /**
     * What an AV Calibration's analysis of its mic file measures (default:
     * a -97.3 dBFS floor, -27.4 LUFS speech, a -9.2 dBTP peak), printed as
     * ffmpeg does.
     * `failed`: it exits 1 with an error instead.
     */
    calibrationAnalysis?:
      | {
          noiseFloorDb: number | "-inf";
          speechLufs: number;
          truePeakDb: number;
        }
      | "failed";
  } = {}
) => {
  const spacedesk: {
    width: number;
    height: number;
    awake: boolean;
    wakeFails: string | undefined;
  } = {
    width: 1920,
    height: 1080,
    awake: false,
    wakeFails: o.wakeFails,
    ...o.spacedesk,
  };
  const dell = o.dell === undefined ? { width: 1920, height: 1080 } : o.dell;
  let wakes = 0;
  /** The injected wake: never the real Spacedesk. */
  const wakeSpacedesk = async () => {
    wakes += 1;
    await new Promise((r) => setTimeout(r, 5));
    if (spacedesk.wakeFails) throw new Error(spacedesk.wakeFails);
    spacedesk.awake = true;
  };
  const recorders: FakeProcess[] = [];
  const cameraCaptures: FakeProcess[] = [];
  /** Each load-sampler.ps1: runs until its capture exits; a test prints its samples. */
  const loadSamplers: FakeProcess[] = [];
  const cameraPreviews: FakeProcess[] = [];
  const screenPreviews: FakeProcess[] = [];
  /** Each Live Stream process, in launch order. */
  const streams: FakeProcess[] = [];
  /** Each one's reading of its card feed. */
  const cardFeeds: ReturnType<typeof readCardFeed>[] = [];
  const cardServers = fakeCardServers(o.hungCardServers);
  const cameraTries = [...(o.cameraTries ?? [])];
  const launchedProcesses: FakeProcess[] = [];
  const launch: Launcher = (l) => {
    const p = fakeProcess(l);
    launchedProcesses.push(p);
    if (l.tool === "nvidia-smi")
      return answer(p, { stdout: `${o.driver ?? "591.74"}\r\n` });
    if (l.tool === "card-server") return cardServers.launch(p);
    if (l.tool === "powershell" && l.script === "screens.ps1") {
      // The older 7-column listing for the first two, as a Windows with an
      // old screens.ps1 would print them; the adapter column after that.
      return answer(p, {
        afterMs: o.screensListingMs,
        stdout:
          "0\t0\t0\t2560\t1440\t\\\\.\\DISPLAY1\tLG HDR QHD\r\n" +
          (dell
            ? `1\t2560\t0\t${dell.width}\t${dell.height}\t\\\\.\\DISPLAY2\tDELL U2424H\r\n`
            : "") +
          (spacedesk.awake
            ? `2\t1920\t0\t${spacedesk.width}\t${spacedesk.height}\t\\\\.\\DISPLAY11\t?\tspacedesk Graphics Adapter\r\n`
            : ""),
      });
    }
    if (l.tool === "powershell" && l.script === "stop-recorders.ps1") {
      // As the script does: every running ffmpeg.exe whose command line has
      // one of the tags, and only tags of CVM's own.
      const tags = (l.args[1] ?? "")
        .split(",")
        .filter((t) => /^cvm-recorder-./.test(t));
      const hits = launchedProcesses.filter(
        (q) =>
          q.running &&
          q.launch.tool === "ffmpeg" &&
          tags.some((t) => q.launch.args.join(" ").includes(t))
      );
      hits.forEach((q) => q.exit(null));
      return answer(p, { stdout: `${hits.length}\r\n` });
    }
    if (l.tool === "powershell" && l.script === "load-sampler.ps1") {
      // As the script does: it ends when the capture it samples does.
      loadSamplers.push(p);
      const capture = cameraCaptures.at(-1);
      if (capture) void capture.exited.then(() => p.running && p.exit(0));
      return p;
    }
    if (l.tool === "powershell" && l.script === "timer-resolution.ps1") {
      const fails = o.tuneFails?.[l.args[l.args.indexOf("-Match") + 1] ?? ""];
      if (fails) return answer(p, { stderr: `${fails}\r\n`, code: 1 });
    }
    if (l.tool === "powershell")
      return answer(p, {
        stdout: "timeBeginPeriod(1) in ffmpeg.exe 42, priority High\r\n",
      });
    if (l.args.includes("-version")) {
      return answer(p, {
        stdout: `ffmpeg version ${o.ffmpegVersion ?? "8.0.1-cvm1"} Copyright (c) 2000-2025\r\n`,
      });
    }
    // A stream-copy remux: `-i <raw> … -c copy <file>`.
    if (l.args.includes("copy")) {
      const input = readFootage(
        path.join(l.cwd, l.args[l.args.indexOf("-i") + 1] ?? "")
      );
      if (input)
        fs.writeFileSync(
          path.join(l.cwd, l.args.at(-1) ?? ""),
          fakeFootage(input.seconds)
        );
      return answer(p, { code: input ? 0 : 1 });
    }
    // 8.0.1 exits 0 after listing, on stderr.
    if (l.args.includes("-list_devices"))
      return answer(p, { stderr: DEVICE_LISTING, code: 0 });
    if (
      o.nvencBusy &&
      (tagged(l, PREVIEW_TAGS.camera) || isPreview(l, "ddagrab")) &&
      l.args.includes("h264_nvenc")
    ) {
      (isPreview(l, "ddagrab") ? screenPreviews : cameraPreviews).push(p);
      return answer(p, { stderr: NVENC_BUSY_STDERR, code: 1 });
    }
    // A camera preview: the frames its capture's relay brings, on to the feeds.
    if (tagged(l, PREVIEW_TAGS.camera)) {
      cameraPreviews.push(p);
      const [relay] = relayPorts(l.args);
      sendFrames(p, l.args, () =>
        cameraCaptures.some(
          (c) =>
            c.running && c.sending && relayPorts(c.launch.args)[0] === relay
        )
      );
      return p;
    }
    // A camera capture: one try at the Cam Link (and the mic).
    if (tagged(l, CAPTURE_TAG)) {
      cameraCaptures.push(p);
      const next = cameraTries.shift() ?? "frames";
      p.stuck = next === "stuck";
      p.sending = next === "frames";
      // Its writer relay's consumer reads EOF when it goes, and quits.
      const writerRelay = relayPorts(l.args)[1];
      void p.exited.then(() =>
        setImmediate(() =>
          recorders
            .filter(
              (r) =>
                r.running &&
                writesFile(r.launch.args, "camera.mkv") &&
                relayPorts(r.launch.args)[0] === writerRelay
            )
            .forEach((r) => r.exit(0))
        )
      );
      if (next === "busy") {
        // What dshow says when OBS has the Cam Link.
        return answer(p, {
          stderr:
            "[dshow @ 0001] [error] Could not run graph (sometimes caused by a device already in use by other application)\r\n",
          code: 1,
        });
      }
      return p;
    }
    // The Live Stream: its banner, then (as ffmpeg) it listens for its feeds.
    if (tagged(l, STREAM_TAG)) {
      streams.push(p);
      p.stuck = o.stream === "never";
      if (o.stream !== "never")
        cardFeeds.push(readCardFeed(p, l.args, o.cardReadBehindMs));
      if (o.stream !== "never")
        setImmediate(() =>
          p.stderr(
            `ffmpeg version ${o.ffmpegVersion ?? "8.0.1-cvm1"} Copyright (c) 2000-2025 the FFmpeg developers\r\n`
          )
        );
      return p;
    }
    if (isPreview(l, "ddagrab")) {
      screenPreviews.push(p);
      sendFrames(p, l.args);
      return p;
    }
    // An AV Calibration's analysis of its mic file (calibration-run.ts).
    if (l.args.some((a) => a.includes("astats="))) {
      const analysis = o.calibrationAnalysis ?? {
        noiseFloorDb: -97.3,
        speechLufs: -27.4,
        truePeakDb: -9.2,
      };
      if (analysis === "failed")
        return answer(p, {
          stderr:
            "[in#0 @ 0001] [error] Error opening input: Invalid data found when processing input\r\n",
          code: 1,
        });
      return answer(p, { stderr: calibrationAnalysisStderr(analysis) });
    }
    if (l.args.some((a) => a.includes("ebur128=framelog=info"))) {
      const loudness = o.micLoudness;
      if (loudness) {
        let t = 0;
        const timer = setInterval(() => {
          t += 0.1;
          const s = loudness(t).toFixed(1);
          p.stderr(
            `${ebur128Line(t, Number(s) + (Math.random() - 0.5) * 3, Number(s))}\r\n`
          );
        }, 100);
        void p.exited.then(() => clearInterval(timer));
      }
      return p;
    }
    // `-i <file>` and nothing else: reading its duration.
    if (l.args.at(-2) === "-i")
      return answer(p, probeAnswer(path.join(l.cwd, l.args.at(-1) ?? "")));
    recorders.push(p);
    if (writesFile(l.args, "camera.mkv"))
      armedWriter(p, relayPorts(l.args)[0]!, o);
    return p;
  };
  /** The level meter's ffmpeg.exe, while one runs. */
  const meter = () =>
    launchedProcesses.find(
      (p) =>
        p.running &&
        p.launch.tool === "ffmpeg" &&
        p.launch.args.some((a) => a.includes("ebur128=framelog=info"))
    );
  /** The latest take's process writing `kind`.mkv (an armed writer only once it has begun). */
  const recorder = (kind: "screen" | "camera") => {
    const p = recorders.findLast(
      (r) =>
        r.launch.tool === "ffmpeg" &&
        writesFile(r.launch.args, `${kind}.mkv`) &&
        (kind === "screen" || r.begun)
    );
    if (!p) throw new Error(`no ${kind} recorder was launched`);
    return p;
  };
  /** How many processes hold the Cam Link now. */
  const camerasRunning = () =>
    launchedProcesses.filter(
      (p) =>
        p.running &&
        p.launch.tool === "ffmpeg" &&
        p.launch.args.some((a) => a.startsWith("video="))
    ).length;
  /** The take writers armed and not yet begun or quit: none has had Record's T0. */
  const armedWriters = () =>
    recorders.filter(
      (r) =>
        r.running &&
        !r.begun &&
        r.launch.tool === "ffmpeg" &&
        writesFile(r.launch.args, "camera.mkv")
    );
  const launched: Launch[] = [];
  const recording: Launcher = (l) => {
    launched.push(l);
    return launch(l);
  };
  return {
    launch: recording,
    launched,
    recorders,
    recorder,
    cameraCaptures,
    loadSamplers,
    cameraPreviews,
    screenPreviews,
    streams,
    cardFeeds,
    cardServers: cardServers.launched,
    armedWriters,
    camerasRunning,
    meter,
    wakeSpacedesk,
    /** How many times the service woke Spacedesk. */
    wakes: () => wakes,
    /** Spacedesk's display, which a test may resize, put to sleep or make fail to wake. */
    spacedesk,
  };
};
