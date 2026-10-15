import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CAM_LINK_FRAME_INTERVAL,
  dshowFrameInterval,
  micAnchor,
} from "./capture-args";
import { takeStartCommand } from "./take-args";
import { CAM_LINK_BUSY, CAM_LINK_NOT_STARTING } from "./camera";
import { CAMERA_STALL_BLOCKS } from "./recording-session";
import { CALIBRATION_REQUIRED, type RecorderCommand } from "./protocol";
import { fakeFootage, fakeWindows } from "./test-utils/fake-windows";
import { previewChunks } from "./test-utils/flv";
import { PREVIEW_CHUNK } from "./preview-feeds";
import {
  connect,
  holdThreadpool,
  readLog,
  recordOnce,
  start,
  T0_MS,
  tmp,
  CALIBRATED,
  CALIBRATION,
} from "./test-utils/service-harness";

/** The recorder service through its WebSocket (test-utils/service-harness.ts). */

describe("start-up checks", () => {
  it("refuses any ffmpeg other than CVM's 8.0.1 build, saying how to install it", async () => {
    const { port } = await start(
      fakeWindows({ ffmpegVersion: "8.1-full_build-www.gyan.dev" })
    );
    const client = await connect(port);
    const hello = await client.next("hello");
    expect(hello.ffmpeg.ok).toBe(false);
    const message = hello.ffmpeg.ok ? "" : hello.ffmpeg.message;
    expect(message).toContain("8.1");
    expect(message).toContain("pnpm --filter @cvm/local ffmpeg:install");

    client.send({ type: "open", videoId: "v1" });
    expect((await client.next("refused")).message).toBe(message);
  });

  it("refuses a stock 8.0.1: only CVM's build can make the screen's colour on the GPU", async () => {
    const { port } = await start(
      fakeWindows({ ffmpegVersion: "8.0.1-full_build-www.gyan.dev" })
    );
    const client = await connect(port);
    const hello = await client.next("hello");
    expect(hello.ffmpeg.ok).toBe(false);
    expect(hello.ffmpeg.ok ? "" : hello.ffmpeg.message).toContain(
      "needs CVM's ffmpeg 8.0.1-cvm1"
    );
  });

  it("only warns when the NVIDIA driver changed since the last start", async () => {
    const stateDir = tmp();
    const first = await start(fakeWindows({ driver: "591.74" }), stateDir);
    expect((await (await connect(first.port)).next("hello")).warnings).toEqual(
      []
    );
    await first.close();

    const second = await start(fakeWindows({ driver: "610.12" }), stateDir);
    const hello = await (await connect(second.port)).next("hello");
    expect(hello.ffmpeg.ok).toBe(true);
    expect(hello.warnings).toHaveLength(1);
    expect(hello.warnings[0]).toContain("591.74 to 610.12");
  });
});

/** The first chunks a browser reads from a preview stream: its config, then a keyframe. */
const watchPreview = (port: number, feed: "camera" | "screen") =>
  new Promise<{ type: string | undefined; kinds: number[] }>((resolve) => {
    http.get(`http://127.0.0.1:${port}/preview/${feed}`, (res) => {
      let bytes = Buffer.alloc(0);
      res.on("data", (c: Buffer) => {
        bytes = Buffer.concat([bytes, c]);
        const chunks = previewChunks(bytes);
        if (chunks.length < 3) return;
        res.destroy();
        resolve({
          type: res.headers["content-type"],
          kinds: chunks.slice(0, 3).map((c) => c.kind),
        });
      });
    });
  });

describe("the Cam Link", () => {
  it("opens with the recorder and is live on its first frame, with camera and screen previews streamed from a keyframe", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    expect(windows.camerasRunning()).toBe(0);

    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    expect(windows.cameraPreviews).toHaveLength(1);

    for (const feed of ["camera", "screen"] as const) {
      const watched = await watchPreview(port, feed);
      expect(watched.type).toBe("application/octet-stream");
      expect(watched.kinds.slice(0, 2)).toEqual([
        PREVIEW_CHUNK.config,
        PREVIEW_CHUNK.key,
      ]);
    }
  });

  it("tries again on its own when no frames come, live on the third try", async () => {
    const { port } = await start(
      fakeWindows({ cameraTries: ["silent", "silent"] })
    );
    const client = await connect(port);
    client.send({ type: "open", videoId: "video-1" });
    await client.next(
      "state",
      (m) =>
        m.state.kind === "open" &&
        m.state.camera.kind === "opening" &&
        m.state.camera.attempt === 3
    );
    await client.camera("live");
  });

  it("asks for a replug after three tries, refuses Record meanwhile, and Retry opens it", async () => {
    const { port, windows } = await start(
      fakeWindows({ cameraTries: ["silent", "silent", "silent"] })
    );
    const client = await connect(port);
    client.send({ type: "open", videoId: "video-1" });
    const stuck = await client.camera("not-starting");
    expect(stuck.state).toMatchObject({
      camera: { message: CAM_LINK_NOT_STARTING },
    });
    expect(windows.cameraPreviews).toHaveLength(3);
    expect(windows.camerasRunning()).toBe(0);

    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect((await client.next("refused")).message).toBe(
      "The camera is not live yet."
    );

    client.send({ type: "retry-camera" });
    await client.camera("live");
  });

  it("says Close OBS first when another program holds it, without trying again or closing anything", async () => {
    const { port, windows } = await start(
      fakeWindows({ cameraTries: ["busy"] })
    );
    const client = await connect(port);
    client.send({ type: "open", videoId: "video-1" });
    const busy = await client.camera("busy");
    expect(busy.state).toMatchObject({ camera: { message: CAM_LINK_BUSY } });
    expect(windows.cameraPreviews).toHaveLength(1);

    client.send({ type: "retry-camera" });
    await client.camera("live");
  });

  it("is opened once with the recorder and held across takes: Record and Stop neither reopen it nor touch the preview (#2207)", async () => {
    const { windows, client } = await recordOnce();
    expect(windows.camerasRunning()).toBe(1);
    expect(windows.cameraCaptures).toHaveLength(1);
    expect(windows.cameraPreviews).toHaveLength(1);
    expect(windows.cameraPreviews[0]!.running).toBe(true);

    client.send({ type: "stop" });
    await client.next("recording-stopped");
    await client.camera("live");
    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    await client.next("recording-started");
    client.send({ type: "stop" });
    await client.next("recording-stopped");
    expect(windows.cameraCaptures).toHaveLength(1);
    expect(windows.cameraPreviews).toHaveLength(1);
    expect(windows.cameraCaptures[0]!.running).toBe(true);
    expect(windows.cameraPreviews[0]!.running).toBe(true);

    client.send({ type: "close" });
    await client.next("state", (m) => m.state.kind === "closed");
    await vi.waitFor(() => expect(windows.camerasRunning()).toBe(0));
    expect(windows.screenPreviews.every((p) => !p.running)).toBe(true);
  });
});

describe("its clients", () => {
  it("survives a client that breaks the WebSocket protocol", async () => {
    const { port } = await start();
    // A raw socket upgrades, then sends an unmasked frame, which no client
    // may send; ws raises an error on that socket.
    const raw = net.connect(port, "127.0.0.1");
    await new Promise((r) => raw.once("connect", r));
    raw.write(
      "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
    );
    await new Promise((r) => raw.once("data", r));
    raw.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    await new Promise((r) => raw.once("close", r));

    const client = await connect(port);
    expect((await client.next("hello")).ffmpeg.ok).toBe(true);
  });
});

describe("a Recording Session", () => {
  it("is refused before the recorder is open for a Video", async () => {
    const { port } = await start();
    const client = await connect(port);
    client.send({
      type: "record",
      silenceLength: "short",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect((await client.next("refused")).command).toBe("record");
  });

  it("cuts with its AV Calibration's threshold, and refuses a Record or prepare-record that carries none", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");

    // From an app server older than the gate: no calibration at all.
    const folder = tmp();
    for (const old of [
      { type: "record", silenceLength: "short", folder, thresholdDb: -38 },
      {
        type: "prepare-record",
        videoId: "video-1",
        silenceLength: "short",
        folder,
      },
      // Older than the camera + mic gate: a calibration naming no camera.
      {
        type: "record",
        silenceLength: "short",
        folder,
        calibration: {
          id: CALIBRATION.id,
          createdAtMs: CALIBRATION.createdAtMs,
          thresholdDb: CALIBRATION.thresholdDb,
          recorderMic: CALIBRATION.recorderMic,
          browserInputLabel: CALIBRATION.browserInputLabel,
        },
      },
    ]) {
      client.send(old as RecorderCommand);
      expect(await client.next("refused")).toEqual({
        type: "refused",
        command: old.type,
        message: CALIBRATION_REQUIRED,
      });
    }

    client.send({
      type: "record",
      silenceLength: "short",
      folder,
      calibration: { ...CALIBRATION, id: "calibration-1", thresholdDb: -36.5 },
    });
    expect(await client.next("recording-started")).toMatchObject({
      thresholdDb: -36.5,
      avCalibrationId: "calibration-1",
      devices: {
        camera: "Cam Link 4K",
        mic: "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)",
      },
    });
    expect(windows.recorder("camera").launch.args.join(" ")).toContain(
      "silencedetect=n=-36.5dB:d=0.8"
    );
  });

  it("records camera, screen and mic to three files and stops on request", async () => {
    const { windows, client, started, folder } = await recordOnce();
    // A file that closes in silence gets one last silence_end: not speech.
    const camera = windows.recorder("camera");
    camera.onQuit = () =>
      camera.stderr(
        "[silencedetect @ 1] silence_end: 20.0 | silence_duration: 20\r\n"
      );
    expect(started.videoId).toBe("video-1");
    expect(started.t0Ms).toBe(T0_MS);
    const files = Object.values(started.files);
    expect(new Set(files).size).toBe(3);
    for (const f of files)
      expect(path.dirname(f).startsWith(folder)).toBe(true);

    client.send({ type: "stop" });
    const stopped = await client.next("recording-stopped");
    expect(stopped.reason).toBe("requested");
    expect(stopped.files).toEqual(started.files);
    expect(stopped.exitCodes).toEqual({ screen: 0, camera: 0 });
    expect(client.received.filter((m) => m.type.startsWith("speech"))).toEqual(
      []
    );
  });

  it("says the take stopped only once its ffmpeg logs are on disk and closed", async () => {
    const { windows, client, started } = await recordOnce();
    const ffmpegLog = path.join(
      path.dirname(started.files.camera),
      "ffmpeg-camera.log"
    );
    const pool = holdThreadpool();
    windows.recorder("camera").stderr("[info] the camera's last line\r\n");
    client.send({ type: "stop" });
    const logWhenStopped = client
      .next("recording-stopped")
      .then(() =>
        fs.existsSync(ffmpegLog) ? fs.readFileSync(ffmpegLog, "utf8") : ""
      );
    // Room for a stop told too early to arrive while the log cannot be
    // written; a stop that waits for its log arrives only after the release.
    await Promise.race([
      logWhenStopped,
      new Promise((r) => setTimeout(r, 100)),
    ]);
    await pool.release();
    expect(await logWhenStopped).toContain("the camera's last line");
  });

  it("captures as the rig proved: separate processes, one T0, the Cam Link at 29.97 to 1440p", async () => {
    const { windows } = await recordOnce();
    const screen = windows.recorder("screen").launch;
    const writer = windows.recorder("camera");
    const camera = windows.cameraCaptures[0]!.launch;
    if (
      screen.tool !== "ffmpeg" ||
      camera.tool !== "ffmpeg" ||
      writer.launch.tool !== "ffmpeg"
    )
      throw new Error("not ffmpeg");
    const s = screen.args.join(" ");
    const c = camera.args.join(" ");
    const w = writer.launch.args.join(" ");

    expect(s).toContain("ddagrab=output_idx=1");
    expect(s).not.toContain("dshow");
    expect(c).not.toContain("ddagrab");
    expect(w).not.toContain("dshow");

    const at = (args: readonly string[], flag: string) =>
      args[args.indexOf(flag) + 1];
    expect(at(camera.args, "-video_size")).toBe("3840x2160");
    expect(dshowFrameInterval(at(camera.args, "-framerate") ?? "")).toBe(
      CAM_LINK_FRAME_INTERVAL
    );
    expect(c).toContain("scale_cuda=2560:1440");

    // One T0: the screen recorder's own, and the one Record told the writer.
    const t0 = `PTS-${(T0_MS / 1000).toFixed(3)}/TB`;
    expect(s).toContain(`setpts=${t0}`);
    expect(writer.written).toBe(takeStartCommand(T0_MS));
    expect(c).toContain(`${micAnchor()}[mic]`);
    expect(w).toContain("silencedetect=n=-38dB:d=2");
  });

  it("turns silencedetect lines into speech events in file time, numbered in order", async () => {
    const { windows, client, started } = await recordOnce();
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 000001] [info] silence_start: -0.0001\r\n");
    camera.stderr(
      "[silencedetect @ 000001] [info] silence_end: 3.52 | silence_duration: 3.52\r\n"
    );
    camera.stderr("[silencedetect @ 000001] [info] silence_start: 9.");
    camera.stderr(
      "1\r\n[silencedetect @ 000001] [info] silence_end: 12.0 | silence_duration: 2.9\r\n"
    );
    camera.stdout("out_time_us=15000000\nprogress=continue\n");

    // The opening silence, before any speech, is the take warming up.
    expect(await client.next("warmed-up")).toMatchObject({ fileTime: 0 });
    expect(await client.next("speech-started")).toMatchObject({
      fileTime: 3.52,
    });
    expect(await client.next("speech-ended")).toMatchObject({ fileTime: 9.1 });
    expect(await client.next("speech-started")).toMatchObject({ fileTime: 12 });

    client.send({ type: "stop" });
    // Speech still going at stop ends where the file does.
    expect(await client.next("speech-ended")).toMatchObject({ fileTime: 15 });
    await client.next("recording-stopped");

    const logged = readLog(
      path.join(path.dirname(started.files.mic), "events.jsonl")
    );
    expect(logged.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        "recording-started",
        "warmed-up",
        "speech-started",
        "speech-ended",
        "recording-stopped",
      ])
    );
    // Once per take: the silence after a speech is its end, not a warm-up.
    expect(logged.filter((e) => e.type === "warmed-up")).toHaveLength(1);
    expect(logged.map((e) => e.seq)).toEqual(logged.map((_, i) => i + 1));
  });

  it("stops when a recorder quits on its own, stopping the other", async () => {
    const { windows, client } = await recordOnce();
    windows
      .recorder("screen")
      .stderr("[ddagrab @ 0001] [error] Failed to capture frame\r\n");
    windows.recorder("screen").exit(1);
    const stopped = await client.next("recording-stopped");
    expect(stopped.reason).toBe("ffmpeg-exited");
    expect(stopped.exitCodes).toEqual({ screen: 1, camera: 0 });
    expect(stopped.errors.join("\n")).toContain("Failed to capture frame");
  });

  it("stops the whole Recording Session and says the camera was lost when the camera capture dies", async () => {
    const { windows, client, started } = await recordOnce();
    windows
      .recorder("camera")
      .stdout("frame=300\nout_time_us=10000000\nprogress=continue\n");
    const capture = windows.cameraCaptures[0]!;
    capture.stderr(
      "[in#0/dshow @ 0001] [error] Error during demuxing: I/O error\r\n"
    );
    capture.exit(1);

    const lost = await client.next("camera-lost");
    expect(lost.fileTime).toBe(10);
    expect(lost.errors.join("\n")).toContain("I/O error");
    const stopped = await client.next("recording-stopped");
    expect(stopped.reason).toBe("camera-lost");
    // The writer closed its files on the relay's end; the screen was asked
    // to close its file, not killed.
    expect(stopped.exitCodes).toEqual({ screen: 0, camera: 0 });
    expect(stopped.files).toEqual(started.files);
    expect(stopped.seq).toBeGreaterThan(lost.seq);
  });

  it("leaves every file readable when a process could not finish its files", async () => {
    const { windows, client, started } = await recordOnce();
    const { files } = started;
    fs.writeFileSync(files.camera, fakeFootage(9.9, { unfinished: true }));
    fs.writeFileSync(files.mic, fakeFootage(9.8, { unfinished: true }));
    fs.writeFileSync(files.screen, fakeFootage(10));
    windows.recorder("camera").exit(1);

    await client.next("recording-stopped");
    expect(fs.readFileSync(files.camera, "utf8")).toBe(fakeFootage(9.9));
    expect(fs.readFileSync(files.mic, "utf8")).toBe(fakeFootage(9.8));
    expect(fs.readFileSync(files.screen, "utf8")).toBe(fakeFootage(10));
  });

  it("says the camera was lost when it stops sending frames for 3 s", async () => {
    const { windows, client } = await recordOnce();
    const camera = windows.recorder("camera");
    // The writer reports every 0.05 s: 3 s is CAMERA_STALL_BLOCKS of them.
    const block = (frame: number, seconds: number) =>
      camera.stdout(
        `frame=${frame}\nout_time_us=${Math.round(seconds * 1_000_000)}\nprogress=continue\n`
      );
    // The Cam Link takes a while to send its first frame: not a loss.
    for (let i = 1; i <= 80; i++) block(0, i * 0.05);
    block(30, 4.05);
    block(60, 4.1);
    for (let i = 1; i < CAMERA_STALL_BLOCKS; i++) block(60, 4.1 + i * 0.05);
    expect(client.received.map((m) => m.type)).not.toContain("camera-lost");
    block(60, 7.1);

    expect((await client.next("camera-lost")).fileTime).toBe(7.1);
    expect((await client.next("recording-stopped")).reason).toBe("camera-lost");
  });

  it("tells every lost frame, camera or screen, the moment it is lost, with where in the take, and totals them at Stop", async () => {
    const { windows, client } = await recordOnce();
    const camera = windows.cameraCaptures[0]!;
    // A gap of 0.233 s after the frame at 4.1 s reaching the writer: about 6 missing.
    windows
      .recorder("camera")
      .stderr(
        "[Eval @ 01] [warning] 4.100000\r\n[Eval @ 01] [warning] -0.233000\r\n"
      );
    expect(await client.next("frames-lost")).toMatchObject({
      camera: 6,
      screen: 0,
      lostFrameSpans: [{ picture: "camera", from: 4.1, to: 4.333, frames: 6 }],
    });
    camera.stderr(
      "[dshow @ 0001] [warning] real-time buffer [Cam Link 4K] [video input] too full or near too full (101% of size: 1500000000 [rtbufsize parameter])! frame dropped!\r\n"
    );
    const dshow = await client.next("frames-lost");
    expect(dshow).toMatchObject({ camera: 7, screen: 0 });
    expect(dshow.lostFrameSpans).toHaveLength(2);
    expect(dshow.lostFrameSpans![1]).toMatchObject({
      picture: "camera",
      frames: 1,
    });
    // The mic's buffer is not a camera frame.
    camera.stderr(
      "[dshow @ 0002] [warning] real-time buffer [Voicemeeter Out B1] [audio input] too full or near too full (101% of size: 1500000000 [rtbufsize parameter])! frame dropped!\r\n"
    );
    // A 0.05 s gap in ddagrab's frames at 60 fps: 2 slots missed.
    windows
      .recorder("screen")
      .stderr(
        "[Eval @ 02] [warning] 9.000000\r\n[Eval @ 02] [warning] -0.050000\r\n"
      );
    expect(await client.next("frames-lost")).toMatchObject({
      camera: 7,
      screen: 2,
    });

    client.send({ type: "stop" });
    const stopped = await client.next("recording-stopped");
    expect(stopped.framesLost).toEqual({ camera: 7, screen: 2 });
    expect(stopped.lostFrameSpans).toContainEqual({
      picture: "screen",
      from: 9,
      to: 9.05,
      frames: 2,
    });
    // Counted, but not an error the editor shows after every take.
    expect(stopped.errors.join("\n")).not.toContain("missing about");
  });

  it("replays the logged events after a given sequence number to a client that missed them", async () => {
    const { windows, client, started, port } = await recordOnce();
    windows
      .recorder("camera")
      .stderr("[silencedetect @ 1] silence_end: 2.0 | silence_duration: 2\r\n");
    await client.next("speech-started");
    client.send({ type: "stop" });
    const stopped = await client.next("recording-stopped");

    const late = await connect(port);
    late.send({
      type: "replay",
      recordingSessionId: started.recordingSessionId,
      afterSeq: 1,
    });
    const done = await late.next("replay-done");
    expect(done.lastSeq).toBe(stopped.seq);
    const replayed = late.received.filter((m) => "seq" in m);
    expect(replayed.map((m) => ("seq" in m ? m.seq : 0))).toEqual(
      Array.from({ length: stopped.seq - 1 }, (_, i) => i + 2)
    );
    expect(replayed.at(-1)).toEqual(stopped);
  });
});
