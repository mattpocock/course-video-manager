import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CAM_LINK_FRAME_INTERVAL, dshowFrameInterval } from "./capture-args";
import { CAM_LINK_BUSY, CAM_LINK_NOT_STARTING } from "./camera";
import { fakeFootage, fakeWindows } from "./test-utils/fake-windows";
import {
  connect,
  readLog,
  recordOnce,
  start,
  T0_MS,
  tmp,
} from "./test-utils/service-harness";

/** The recorder service through its WebSocket (test-utils/service-harness.ts). */

describe("start-up checks", () => {
  it("refuses any ffmpeg other than 8.0.1, saying how to install it", async () => {
    const { port } = await start(
      fakeWindows({ ffmpegVersion: "8.1-full_build-www.gyan.dev" })
    );
    const client = await connect(port);
    const hello = await client.next("hello");
    expect(hello.ffmpeg.ok).toBe(false);
    const message = hello.ffmpeg.ok ? "" : hello.ffmpeg.message;
    expect(message).toContain("8.1");
    expect(message).toContain("winget install Gyan.FFmpeg --version 8.0.1");

    client.send({ type: "open", videoId: "v1" });
    expect((await client.next("refused")).message).toBe(message);
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

/** The first bytes a browser gets from a preview feed. */
const firstPreviewBytes = (port: number, feed: "camera" | "screen") =>
  new Promise<{ type: string | undefined; body: string }>((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/preview/${feed}`, (res) => {
      res.once("data", (chunk: Buffer) => {
        resolve({
          type: res.headers["content-type"],
          body: chunk.toString("latin1"),
        });
        req.destroy();
      });
    });
  });

describe("the Cam Link", () => {
  it("opens with the recorder and is live on its first frame, with raw camera and screen previews", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    expect(windows.camerasRunning()).toBe(0);

    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    expect(windows.cameraPreviews).toHaveLength(1);

    for (const feed of ["camera", "screen"] as const) {
      const { type, body } = await firstPreviewBytes(port, feed);
      expect(type).toContain("multipart/x-mixed-replace");
      expect(body).toContain("Content-Type: image/jpeg");
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

    client.send({ type: "record", silenceLength: "long", folder: tmp() });
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

  it("is held only while the recorder is open, by the preview or the recording", async () => {
    const { windows, client } = await recordOnce();
    expect(windows.camerasRunning()).toBe(1);
    expect(windows.cameraPreviews.every((p) => !p.running)).toBe(true);

    client.send({ type: "stop" });
    await client.next("recording-stopped");
    await client.camera("live");
    expect(windows.camerasRunning()).toBe(1);

    client.send({ type: "close" });
    await client.next("state", (m) => m.state.kind === "closed");
    await vi.waitFor(() => expect(windows.camerasRunning()).toBe(0));
    expect(windows.screenPreviews.every((p) => !p.running)).toBe(true);
  });
});

describe("a Recording Session", () => {
  it("is refused before the recorder is open for a Video", async () => {
    const { port } = await start();
    const client = await connect(port);
    client.send({ type: "record", silenceLength: "short", folder: tmp() });
    expect((await client.next("refused")).command).toBe("record");
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

  it("captures as the rig proved: separate processes, one T0, the Cam Link at 29.97 to 1440p", async () => {
    const { windows } = await recordOnce();
    const screen = windows.recorder("screen").launch;
    const camera = windows.recorder("camera").launch;
    if (screen.tool !== "ffmpeg" || camera.tool !== "ffmpeg")
      throw new Error("not ffmpeg");
    const s = screen.args.join(" ");
    const c = camera.args.join(" ");

    expect(s).toContain("ddagrab=output_idx=1");
    expect(s).not.toContain("dshow");
    expect(c).not.toContain("ddagrab");

    const at = (args: readonly string[], flag: string) =>
      args[args.indexOf(flag) + 1];
    expect(at(camera.args, "-video_size")).toBe("3840x2160");
    expect(dshowFrameInterval(at(camera.args, "-framerate") ?? "")).toBe(
      CAM_LINK_FRAME_INTERVAL
    );
    expect(c).toContain("scale_cuda=2560:1440");

    const t0 = `PTS-${(T0_MS / 1000).toFixed(3)}/TB`;
    expect(s).toContain(`setpts=${t0}`);
    expect(c).toContain(`setpts=${t0}`);
    expect(c).toContain(`asetpts=${t0}`);
    expect(c).toContain("silencedetect=n=-38dB:d=2");
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
        "speech-started",
        "speech-ended",
        "recording-stopped",
      ])
    );
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

  it("stops the whole Recording Session and says the camera was lost when the camera process dies", async () => {
    const { windows, client, started } = await recordOnce();
    const camera = windows.recorder("camera");
    camera.stdout("frame=300\nout_time_us=10000000\nprogress=continue\n");
    camera.stderr(
      "[in#0/dshow @ 0001] [error] Error during demuxing: I/O error\r\n"
    );
    camera.exit(1);

    const lost = await client.next("camera-lost");
    expect(lost.fileTime).toBe(10);
    expect(lost.errors.join("\n")).toContain("I/O error");
    const stopped = await client.next("recording-stopped");
    expect(stopped.reason).toBe("camera-lost");
    // The screen was asked to close its file, not killed.
    expect(stopped.exitCodes).toEqual({ screen: 0, camera: 1 });
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
    const block = (frame: number, seconds: number) =>
      camera.stdout(
        `frame=${frame}\nout_time_us=${seconds * 1_000_000}\nprogress=continue\n`
      );
    // The Cam Link takes a while to send its first frame: not a loss.
    block(0, 1);
    block(0, 2);
    block(0, 3);
    block(0, 4);
    block(30, 5);
    block(60, 6);
    block(60, 7);
    block(60, 8);
    expect(client.received.map((m) => m.type)).not.toContain("camera-lost");
    block(60, 9);

    expect((await client.next("camera-lost")).fileTime).toBe(9);
    expect((await client.next("recording-stopped")).reason).toBe("camera-lost");
  });

  it("reports the Cam Link's dropped frames when it stops, and the screen's as not measured", async () => {
    const { windows, client } = await recordOnce();
    const camera = windows.recorder("camera");
    camera.stderr(
      "[dshow @ 0001] [warning] real-time buffer [Cam Link 4K] [video input] too full or near too full (101% of size: 1500000000 [rtbufsize parameter])! frame dropped!\r\n"
    );
    // The mic's buffer is not a camera frame.
    camera.stderr(
      "[dshow @ 0002] [warning] real-time buffer [Voicemeeter Out B1] [audio input] too full or near too full (101% of size: 1500000000 [rtbufsize parameter])! frame dropped!\r\n"
    );

    client.send({ type: "stop" });
    expect((await client.next("recording-stopped")).framesLost).toEqual({
      camera: 1,
      screen: null,
    });
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

describe("crash recovery", () => {
  it("repairs a Recording Session cut off without a stop, keeping the raw files, and reports it crashed", async () => {
    // A recorder service dies mid-take: its Recording Session's log has no
    // stop, and ffmpeg never finished the camera's and mic's files.
    const crashed = await recordOnce();
    const { files, recordingSessionId } = crashed.started;
    crashed.windows
      .recorder("camera")
      .stderr("[silencedetect @ 1] silence_end: 2.0 | silence_duration: 2\r\n");
    await crashed.client.next("speech-started");
    fs.writeFileSync(files.camera, fakeFootage(12.5, { unfinished: true }));
    fs.writeFileSync(files.screen, fakeFootage(12.6));
    fs.writeFileSync(files.mic, fakeFootage(12.4, { unfinished: true }));

    const windows = fakeWindows();
    const { port } = await start(windows, crashed.stateDir);
    const client = await connect(port);
    expect((await client.next("hello")).recovered).toEqual([
      recordingSessionId,
    ]);

    client.send({ type: "replay", recordingSessionId, afterSeq: 0 });
    await client.next("replay-done");
    const report = await client.next("recording-crashed");
    expect(report.repairs).toEqual({
      camera: "remuxed",
      screen: "readable",
      mic: "remuxed",
    });
    // The take still going at the crash ends where the mic file now does.
    const speech = client.received.filter((m) => m.type === "speech-ended");
    expect(speech).toMatchObject([{ fileTime: 12.4 }]);

    expect(fs.readFileSync(files.camera, "utf8")).toBe(fakeFootage(12.5));
    expect(fs.readFileSync(files.mic, "utf8")).toBe(fakeFootage(12.4));
    for (const file of [files.camera, files.mic])
      expect(fs.existsSync(file.replace(/\.mkv$/, ".raw.mkv"))).toBe(true);
    // Any ffmpeg.exe still recording for it is stopped before its files are touched.
    expect(windows.launched).toContainEqual(
      expect.objectContaining({
        script: "stop-recorders.ps1",
        args: ["-Tags", `cvm-recorder-${recordingSessionId}`],
      })
    );

    // Once repaired, a later start leaves it alone.
    const again = await start(fakeWindows(), crashed.stateDir);
    expect((await (await connect(again.port)).next("hello")).recovered).toEqual(
      []
    );
  });
});
