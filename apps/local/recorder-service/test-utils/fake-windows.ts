import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import type { Launch, LaunchedProcess, Launcher } from "../launcher";

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
 * Link (`CameraTry`); one that gets frames sends a few tiny JPEGs a second to
 * the service's preview feed, as ffmpeg's mpjpeg would.
 * Nothing here opens a real device.
 */

/**
 * One try at opening the Cam Link: frames arrive, nothing arrives (the
 * Cam Link's start-up trouble), or another program holds it.
 */
export type CameraTry = "frames" | "silent" | "busy";

export type FakeProcess = LaunchedProcess & {
  launch: Launch;
  stdout(text: string): void;
  stderr(text: string): void;
  exit(code: number | null): void;
  /** False once it has exited. */
  readonly running: boolean;
  /** What it prints between `q` and exiting. */
  onQuit?: () => void;
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
    writeStdin: (text) => {
      // ffmpeg closes its files and exits 0 on `q`.
      if (text === "q") {
        setImmediate(() => {
          p.onQuit?.();
          p.exit(0);
        });
      }
    },
    exited,
    kill: () => p.exit(null),
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

/** Answers a short-lived process on the next tick, then exits it. */
const answer = (
  p: FakeProcess,
  o: { stdout?: string; stderr?: string; code?: number }
) => {
  setImmediate(() => {
    if (o.stdout) p.stdout(o.stdout);
    if (o.stderr) p.stderr(o.stderr);
    p.exit(o.code ?? 0);
  });
  return p;
};

const DEVICE_LISTING = [
  '[in#0 @ 000001] "Cam Link 4K" (video)',
  '[in#0 @ 000001]   Alternative name "@device_pnp_\\\\?\\usb#vid_0fd9"',
  '[in#0 @ 000001] "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)" (audio)',
  "Error opening input file dummy.",
].join("\r\n");

const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

/** What the camera preview process sends to the still feed (its second output). */
export const FAKE_STILL_JPEG = Buffer.from([0xff, 0xd8, 0x57, 0xff, 0xd9]);

/**
 * Sends a "JPEG" to each feed in the args every 20 ms until exit: `jpegs[i]`
 * to the i-th `tcp://` output.
 */
const sendFrames = (
  p: FakeProcess,
  args: readonly string[],
  jpegs: Buffer[]
) => {
  const ports = [...args.join(" ").matchAll(/tcp:\/\/127\.0\.0\.1:(\d+)/g)].map(
    (m) => Number(m[1])
  );
  const sockets = ports.map((port) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    return socket;
  });
  const timer = setInterval(() => {
    sockets.forEach((socket, i) => {
      const jpeg = jpegs[i] ?? TINY_JPEG;
      socket.write(
        `--ffmpeg\r\nContent-Type: image/jpeg\r\nContent-length: ${jpeg.length}\r\n\r\n`
      );
      socket.write(jpeg);
      socket.write("\r\n");
    });
  }, 20);
  void p.exited.then(() => {
    clearInterval(timer);
    sockets.forEach((socket) => socket.destroy());
  });
};

const isPreview = (l: Launch, input: string) =>
  l.tool === "ffmpeg" &&
  l.args.some((a) => a.includes("tcp://")) &&
  !l.args.some((a) => a.endsWith(".mkv")) &&
  l.args.some((a) => a.includes(input));

export const fakeWindows = (
  o: {
    ffmpegVersion?: string;
    driver?: string;
    /** Each try at the Cam Link in turn; every try after these gets frames. */
    cameraTries?: CameraTry[];
    /** A real JPEG per preview and for the still, for a browser to show (verify-cvm). */
    jpeg?: { camera: Buffer; screen: Buffer; still?: Buffer };
    /** The recording's camera + mic process: its first frame comes at once, or never. */
    recordingCamera?: "frames" | "silent";
  } = {}
) => {
  const recorders: FakeProcess[] = [];
  const cameraPreviews: FakeProcess[] = [];
  const screenPreviews: FakeProcess[] = [];
  const cameraTries = [...(o.cameraTries ?? [])];
  const launch: Launcher = (l) => {
    const p = fakeProcess(l);
    if (l.tool === "nvidia-smi")
      return answer(p, { stdout: `${o.driver ?? "591.74"}\r\n` });
    if (l.tool === "powershell" && l.script === "screens.ps1") {
      return answer(p, {
        stdout:
          "0\t0\t0\t2560\t1440\t\\\\.\\DISPLAY1\tLG HDR QHD\r\n1\t2560\t0\t1920\t1080\t\\\\.\\DISPLAY2\tDELL U2424H\r\n",
      });
    }
    if (l.tool === "powershell" && l.script === "stop-recorders.ps1")
      return answer(p, { stdout: "0\r\n" });
    if (l.tool === "powershell")
      return answer(p, {
        stdout: "timeBeginPeriod(1) in ffmpeg.exe 42, priority High\r\n",
      });
    if (l.args.includes("-version")) {
      return answer(p, {
        stdout: `ffmpeg version ${o.ffmpegVersion ?? "8.0.1-full_build-www.gyan.dev"} Copyright (c) 2000-2025\r\n`,
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
    if (isPreview(l, "video=")) {
      cameraPreviews.push(p);
      const next = cameraTries.shift() ?? "frames";
      if (next === "frames")
        sendFrames(p, l.args, [
          o.jpeg?.camera ?? TINY_JPEG,
          o.jpeg?.still ?? FAKE_STILL_JPEG,
        ]);
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
    if (isPreview(l, "ddagrab")) {
      screenPreviews.push(p);
      sendFrames(p, l.args, [o.jpeg?.screen ?? TINY_JPEG]);
      return p;
    }
    // `-i <file>` and nothing else: reading its duration.
    if (l.args.at(-2) === "-i")
      return answer(p, probeAnswer(path.join(l.cwd, l.args.at(-1) ?? "")));
    recorders.push(p);
    if (l.args.includes("camera.mkv") && o.recordingCamera !== "silent")
      setImmediate(() =>
        p.stdout("frame=1\nout_time_us=0\nprogress=continue\n")
      );
    return p;
  };
  const recorder = (kind: "screen" | "camera") => {
    const p = recorders.find(
      (r) => r.launch.tool === "ffmpeg" && r.launch.args.includes(`${kind}.mkv`)
    );
    if (!p) throw new Error(`no ${kind} recorder was launched`);
    return p;
  };
  /** How many camera processes (preview or recording) hold the Cam Link now. */
  const camerasRunning = () =>
    [...cameraPreviews, ...recorders].filter(
      (p) =>
        p.running &&
        p.launch.tool === "ffmpeg" &&
        p.launch.args.some((a) => a.startsWith("video="))
    ).length;
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
    cameraPreviews,
    screenPreviews,
    camerasRunning,
  };
};
