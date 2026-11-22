import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cameraCaptureArgs } from "./capture-args";
import { cameraWriterArgs, takeStartCommand } from "./take-args";

/**
 * THE LONG-LIVED CAPTURE IN THE REAL FFMPEG (#2207), Linux and synthetic:
 * a 29.97 fps picture and a tone stand in for the Cam Link and the mic, the
 * GPU scale is left out and libx264 stands in for NVENC (CI has no GPU).
 * Everything else is the service's own arguments: the capture's relays, the
 * armed writer, and Record's T0 on its stdin.
 *
 *   - The take starts at T0 to the frame, with no frame repeated to fill
 *     in, and the mic from its first milliseconds: no device opens at
 *     Record.
 *   - The preview's consumer dying, stalling or never being there leaves
 *     camera.mkv whole, with no gap.
 *   - The writer dying leaves the preview's frames coming as before.
 *   - Take after take on the same relay: a Stop's writer goes, the next
 *     one arms there, and the capture and its preview carry on; a preview
 *     started again connects mid-take and the take carries on (#2211).
 */

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const CAMERA =
  "testsrc2=size=320x180:rate=30000/1001,format=nv12,settb=1/10000000,realtime";
const MIC =
  "sine=f=440:sample_rate=48000:samples_per_frame=960,arealtime,aformat=s16:channel_layouts=stereo,asettb=1/10000000";
const FPS = 30000 / 1001;
const TAKE_MS = 3_000;

/** The capture's arguments with the devices swapped for synthetic ones, and no GPU. */
const synthetic = (argv: readonly string[]) => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-f" && argv[i + 1] === "dshow") {
      let j = i;
      while (argv[j] !== "-i") j++;
      const video = argv[j + 1]!.startsWith("video=");
      out.push("-f", "lavfi", "-i", video ? CAMERA : MIC);
      i = j + 1;
      continue;
    }
    out.push(
      argv[i]!.replace(
        "hwupload_cuda,scale_cuda=2560:1440:interp_algo=bicubic,hwdownload,format=nv12",
        "format=nv12"
      )
    );
  }
  return out;
};

/** The writer's arguments with libx264 in NVENC's place (same GOP and B-frames). */
const onCpu = (argv: readonly string[]) => {
  const out = [...argv];
  const at = out.indexOf("h264_nvenc");
  const end = out.indexOf("-g", at);
  out.splice(at, end - at, "libx264", "-preset", "ultrafast", "-bf", "2");
  return out;
};

const unusedPort = async () => {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((r) => server.close(r));
  return port;
};

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const run = (args: string[], cwd: string) => {
  const child = spawn("ffmpeg", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  let stderr = "";
  child.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
  child.stdout!.resume();
  child.stdin!.on("error", () => {});
  const exited = new Promise<number | null>((r) => child.once("exit", r));
  return { child, stderr: () => stderr, exited };
};

/** The preview relay's consumer, standing in for the camera preview: when each chunk came. */
const previewConsumer = async (
  port: number,
  o: { after?: "dies" | "stalls"; readMs?: number } = {}
) => {
  const arrivals: number[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on("data", () => arrivals.push(Date.now()));
    socket.on("error", () => {});
    if (o.after)
      setTimeout(() => {
        if (o.after === "dies") {
          socket.destroy();
          server.close();
        } else socket.pause();
      }, o.readMs ?? 1_000);
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    arrivals,
    close: () => {
      sockets.forEach((s) => s.destroy());
      server.close();
    },
  };
};

const waitFor = async (check: () => boolean, ms = 10_000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** The decoded frames' hashes, in order. */
const frameHashes = (file: string) =>
  execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "framemd5", "-"])
    .toString()
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(",").at(-1)!.trim());

/** How many frames at the start repeat the first. */
const headRepeats = (frames: string[]) =>
  frames.findIndex((f) => f !== frames[0]) - 1;

/** How many frames repeat the one before. */
const repeats = (frames: string[]) =>
  frames.filter((f, i) => i > 0 && f === frames[i - 1]).length;

/** Where the mic file's first sound starts, in seconds (silencedetect at -50 dB). */
const firstSound = (file: string) =>
  spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      file,
      "-af",
      "silencedetect=n=-50dB:d=0.005",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" }
  ).stderr;

/**
 * One take on a running capture: the writer armed and reading, T0 on its
 * stdin, `TAKE_MS` of recording (with `during` run at its start), then
 * Stop as the service stops one: its tail, then `q`.
 */
const take = async (o: {
  dir: string;
  writerPort: number;
  during?: (writer: ReturnType<typeof run>) => Promise<void> | void;
}) => {
  const writer = run(
    onCpu(
      cameraWriterArgs({
        relayPort: o.writerPort,
        tag: "test",
        silenceLength: "short",
        thresholdDb: -40,
      })
    ),
    o.dir
  );
  await waitFor(() =>
    /Input #0, matroska,webm, from 'tcp:/.test(writer.stderr())
  );
  // Armed: everything it reads is dropped until Record.
  await new Promise((r) => setTimeout(r, 1_000));
  const t0Ms = Date.now();
  writer.child.stdin!.write(takeStartCommand(t0Ms));
  await o.during?.(writer);
  await new Promise((r) => setTimeout(r, TAKE_MS));
  const stopMs = Date.now();
  await new Promise((r) => setTimeout(r, 250));
  writer.child.stdin!.write("q");
  const code = await writer.exited;
  return { code, t0Ms, stopMs, writer };
};

const startCapture = async (dir: string) => {
  const ports = { preview: await unusedPort(), writer: await unusedPort() };
  const capture = run(
    synthetic(cameraCaptureArgs({ camera: "c", mic: "m", relays: ports })),
    dir
  );
  return { ports, capture };
};

describe.skipIf(!hasFfmpeg)(
  "the long-lived capture, in the real ffmpeg",
  () => {
    it("starts a take within a keyboard period of T0, picture and mic, with nothing written before Record", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "take-"));
      dirs.push(dir);
      const { ports } = await startCapture(dir);
      const preview = await previewConsumer(ports.preview);
      try {
        const { code, t0Ms, stopMs, writer } = await take({
          dir,
          writerPort: ports.writer,
        });
        expect(code).toBe(0);
        const frames = frameHashes(path.join(dir, "camera.mkv"));
        // The first real frame comes within a keyboard period of T0
        // (Record's T0 reaches the writer on its stdin): at most a few are
        // repeated to fill the start. A synthetic frame drawn late on a busy
        // machine may be repeated later too, as a late Cam Link frame would.
        expect(headRepeats(frames)).toBeLessThanOrEqual(4);
        expect(repeats(frames)).toBeLessThanOrEqual(6);
        const expected = ((stopMs - t0Ms) / 1000) * FPS;
        expect(frames.length).toBeGreaterThanOrEqual(Math.floor(expected) - 2);
        expect(frames.length).toBeLessThanOrEqual(
          Math.ceil(expected + 0.3 * FPS) + 2
        );
        // The tone from the start: any silence padded in front is under 150 ms.
        const sound = firstSound(path.join(dir, "mic.mkv"));
        const leading = sound.match(/silence_start: (-?[\d.]+)/);
        if (leading && Number(leading[1]) <= 0.001) {
          const end = sound.match(/silence_end: ([\d.]+)/);
          expect(Number(end?.[1])).toBeLessThan(0.15);
        }
        expect(writer.stderr()).not.toMatch(/\[warning\] -\d/);
      } finally {
        preview.close();
      }
    }, 30_000);

    it.each([
      ["dies mid-take", "dies"],
      ["stalls mid-take (connected, never reading)", "stalls"],
      ["is never there", "absent"],
    ] as const)(
      "leaves camera.mkv whole, with no gap, when the preview's consumer %s",
      async (_, mode) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "take-"));
        dirs.push(dir);
        const { ports } = await startCapture(dir);
        const preview =
          mode === "absent"
            ? undefined
            : await previewConsumer(ports.preview, {
                after: mode,
                readMs: 2_000,
              });
        try {
          const { code, t0Ms, stopMs, writer } = await take({
            dir,
            writerPort: ports.writer,
          });
          expect(code).toBe(0);
          const frames = frameHashes(path.join(dir, "camera.mkv"));
          expect(repeats(frames)).toBeLessThanOrEqual(3);
          expect(frames.length).toBeGreaterThanOrEqual(
            Math.floor(((stopMs - t0Ms) / 1000) * FPS) - 2
          );
          expect(writer.stderr()).not.toMatch(/\[warning\] -\d/);
        } finally {
          preview?.close();
        }
      },
      30_000
    );

    it("records take after take on the same relay: each Stop's writer goes, the next arms there, and the capture and preview never notice (#2211)", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "take-"));
      dirs.push(dir);
      const { ports, capture } = await startCapture(dir);
      const preview = await previewConsumer(ports.preview);
      try {
        const takes = [];
        for (const name of ["first", "second"]) {
          const takeDir = path.join(dir, name);
          fs.mkdirSync(takeDir);
          takes.push({
            dir: takeDir,
            ...(await take({ dir: takeDir, writerPort: ports.writer })),
          });
        }
        // NUT relays crashed the capture here, the moment the second writer
        // connected: every Stop reopened the Cam Link and the mic.
        expect(capture.child.exitCode).toBeNull();
        for (const t of takes) {
          expect(t.code).toBe(0);
          // Whole, and playable to the press: no gap, nothing cut short.
          const frames = frameHashes(path.join(t.dir, "camera.mkv"));
          expect(frames.length).toBeGreaterThanOrEqual(
            Math.floor(((t.stopMs - t.t0Ms) / 1000) * FPS) - 2
          );
          expect(t.writer.stderr()).not.toMatch(/\[warning\] -\d/);
          const mic = spawnSync(
            "ffprobe",
            [
              "-v",
              "error",
              "-show_entries",
              "format=duration",
              "-of",
              "csv=p=0",
              path.join(t.dir, "mic.mkv"),
            ],
            { encoding: "utf8" }
          ).stdout;
          expect(Number(mic)).toBeGreaterThanOrEqual(
            (t.stopMs - t.t0Ms) / 1000 - 0.05
          );
        }
        // The preview's frames kept coming across both Stops and arms.
        const from = takes[0]!.stopMs;
        const after = preview.arrivals.filter((t) => t >= from);
        const gaps = after.slice(1).map((t, i) => t - after[i]!);
        expect(Math.max(...gaps)).toBeLessThan(200);
      } finally {
        preview.close();
      }
    }, 40_000);

    it("keeps the take whole when a preview started again connects mid-take, and that preview gets the frames (#2211)", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "take-"));
      dirs.push(dir);
      const { ports, capture } = await startCapture(dir);
      const first = await previewConsumer(ports.preview, {
        after: "dies",
        readMs: 2_000,
      });
      let again: Awaited<ReturnType<typeof previewConsumer>> | undefined;
      try {
        const { code, t0Ms, stopMs, writer } = await take({
          dir,
          writerPort: ports.writer,
          during: async () => {
            await new Promise((r) => setTimeout(r, 1_500));
            again = await previewConsumer(ports.preview);
          },
        });
        // NUT relays crashed the capture here, ending the take.
        expect(capture.child.exitCode).toBeNull();
        expect(code).toBe(0);
        const frames = frameHashes(path.join(dir, "camera.mkv"));
        expect(frames.length).toBeGreaterThanOrEqual(
          Math.floor(((stopMs - t0Ms) / 1000) * FPS) - 2
        );
        expect(writer.stderr()).not.toMatch(/\[warning\] -\d/);
        expect(again!.arrivals.length).toBeGreaterThan(0);
      } finally {
        first.close();
        again?.close();
      }
    }, 30_000);

    it("keeps the take running when the writer stalls for seconds at Record, as NVENC opening on a loaded machine stalls it", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "take-"));
      dirs.push(dir);
      const { ports, capture } = await startCapture(dir);
      const preview = await previewConsumer(ports.preview);
      try {
        let exitedAt = 0;
        const { code, stopMs, writer } = await take({
          dir,
          writerPort: ports.writer,
          during: async (w) => {
            void w.exited.then(() => (exitedAt = Date.now()));
            // Longer than the relay's buffers and the 2 s socket timeout
            // the relay had, which closed it and so ended the take (#2344).
            await new Promise((r) => setTimeout(r, 300));
            w.child.kill("SIGSTOP");
            await new Promise((r) => setTimeout(r, 4_000));
            w.child.kill("SIGCONT");
          },
        });
        expect(writer.stderr()).not.toMatch(/File ended prematurely/);
        // The writer ran until Stop's `q`, not until the relay was cut.
        expect(exitedAt).toBeGreaterThan(stopMs);
        expect(code).toBe(0);
        expect(capture.child.exitCode).toBeNull();
        // Frames after the stall are in camera.mkv: the take went on.
        const frames = frameHashes(path.join(dir, "camera.mkv"));
        expect(frames.length).toBeGreaterThan(Math.floor(5 * FPS));
      } finally {
        preview.close();
      }
    }, 40_000);

    it("keeps the preview's frames coming, with no gap, when the writer dies mid-take", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "take-"));
      dirs.push(dir);
      const { ports, capture } = await startCapture(dir);
      const preview = await previewConsumer(ports.preview);
      try {
        let killedAt = 0;
        await take({
          dir,
          writerPort: ports.writer,
          during: async (writer) => {
            await new Promise((r) => setTimeout(r, 1_000));
            killedAt = Date.now();
            writer.child.kill("SIGKILL");
          },
        });
        const after = preview.arrivals.filter((t) => t >= killedAt);
        const gaps = after.slice(1).map((t, i) => t - after[i]!);
        expect(after.length).toBeGreaterThan(0);
        expect(Math.max(...gaps)).toBeLessThan(200);
        expect(after.at(-1)! - killedAt).toBeGreaterThan(TAKE_MS - 500);
        expect(capture.child.exitCode).toBeNull();
      } finally {
        preview.close();
      }
    }, 30_000);
  }
);
