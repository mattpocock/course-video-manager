import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CAM_LINK_NOT_STARTING } from "./camera";
import { micOnClock } from "./capture-args";
import { METER_WHILE_RECORDING, RECORD_WHILE_METERING } from "./protocol";
import {
  CLOSE_OBS_TO_CALIBRATE,
  runMeasurementWindows,
} from "../app/av-calibration-constants";
import { ebur128Line } from "./test-utils/fake-windows";
import { connect, start, tmp, CALIBRATED } from "./test-utils/service-harness";

/** The level meter through the WebSocket (test-utils/service-harness.ts). */

/**
 * A synthetic mic file as the run's capture writes it while it records:
 * 16-bit stereo 48 kHz, ffmpeg's LIST of metadata before the samples, the
 * data size not yet filled in. A faint hiss, and a sharp clap at each of
 * `clapsS` (its file seconds), up to `toSeconds`.
 */
const SAMPLE_RATE = 48_000;
const writeMic = (file: string, clapsS: number[], toSeconds: number) => {
  // ICMT "cvm-recorder-meter\0": 19 bytes, padded to an even 20.
  const comment = Buffer.alloc(28);
  comment.write("ICMT", 0, "ascii");
  comment.writeUInt32LE(19, 4);
  comment.write("cvm-recorder-meter", 8, "ascii");
  const list = Buffer.concat([
    Buffer.from("LIST", "ascii"),
    Buffer.alloc(4),
    Buffer.from("INFO", "ascii"),
    comment,
  ]);
  list.writeUInt32LE(list.length - 8, 4);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(2, 10);
  fmt.writeUInt32LE(SAMPLE_RATE, 12);
  fmt.writeUInt32LE(SAMPLE_RATE * 4, 16);
  fmt.writeUInt16LE(4, 20);
  fmt.writeUInt16LE(16, 22);
  const frames = Math.round(toSeconds * SAMPLE_RATE);
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE;
    let x = 0.0001 * Math.sin(i * 2.3);
    for (const c of clapsS)
      if (t >= c) x += 0.5 * Math.exp(-(t - c) / 0.005) * Math.sin(i * 1.1);
    const v = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from("RIFF\xff\xff\xff\xffWAVE", "latin1"),
      fmt,
      list,
      Buffer.from("data\xff\xff\xff\xff", "latin1"),
      data,
    ])
  );
};

/**
 * The capture's camera motion over `[fromS, toS)`, printed as its
 * `metadata=print` logs it: each frame's pts_time line, then its YAVG line.
 * The hands close over 0.25 s and stop dead at each of `contactsS`.
 */
const FRAME_S = 1001 / 30_000;
const motionLines = (contactsS: number[], fromS: number, toS: number) => {
  const lines: string[] = [];
  for (let n = Math.ceil(fromS / FRAME_S); n * FRAME_S < toS; n++) {
    const t = n * FRAME_S;
    let moving = 0;
    for (const c of contactsS) {
      const from = Math.max(t - FRAME_S, c - 0.25);
      moving += Math.max(0, Math.min(t, c) - from) / FRAME_S;
    }
    const level = 0.2 + 0.05 * Math.sin(n * 1.7) + 6 * moving;
    lines.push(
      `[Parsed_metadata_9 @ 000001d3] [info] frame:${n}    pts:${n}       pts_time:${t.toFixed(6)}`,
      `[Parsed_metadata_9 @ 000001d3] [info] lavfi.signalstats.YAVG=${level.toFixed(5)}`
    );
  }
  return `${lines.join("\r\n")}\r\n`;
};

describe("the level meter", () => {
  it("streams ebur128's readings of the mic, and never runs alongside a recording", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");

    client.send({ type: "start-meter" });
    expect(await client.next("meter-started")).toMatchObject({
      mic: "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)",
    });
    const meter = windows.meter();
    expect(meter?.launch.args).toContain(
      "audio=Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)"
    );
    // ebur128's lines, as ffmpeg 8.0.1 prints them, among others that are not readings.
    meter?.stderr(
      "[aist#0:0/pcm_s16le @ 0000] [info] Starting thread...\r\n" +
        "[Parsed_ebur128_0 @ 000001d2] [info] t: 0.1   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU\r\n" +
        "[Parsed_ebur128_0 @ 000001d2] [info] t: 3.2   TARGET:-23 LUFS    M: -36.4 S: -38.1     I: -37.9 LUFS       LRA:   2.1 LU\r\n"
    );
    expect(await client.next("meter-reading")).toEqual({
      type: "meter-reading",
      seconds: 0.1,
      momentaryLufs: -120.7,
      shortTermLufs: -120.7,
    });
    expect(await client.next("meter-reading")).toEqual({
      type: "meter-reading",
      seconds: 3.2,
      momentaryLufs: -36.4,
      shortTermLufs: -38.1,
    });

    // Record is refused while the meter runs...
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    client.send({
      type: "record",
      silenceLength: "short",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect((await client.next("refused")).message).toBe(RECORD_WHILE_METERING);

    // ...and once it stops, the mic is let go and Record records.
    client.send({ type: "stop-meter" });
    expect(await client.next("meter-stopped")).toMatchObject({ message: null });
    expect(windows.meter()).toBeUndefined();
    client.send({
      type: "record",
      silenceLength: "short",
      folder: tmp(),
      ...CALIBRATED,
    });
    await client.next("recording-started");

    // The meter is refused while recording.
    client.send({ type: "start-meter" });
    expect(await client.next("refused")).toMatchObject({
      command: "start-meter",
      message: METER_WHILE_RECORDING,
    });
    expect(windows.meter()).toBeUndefined();
  });

  it("runs an AV Calibration: the mic and camera to files on one clock, started once live, then the noise floor and speech loudness of its windows and the true peak of all but the claps; a cancelled run keeps nothing", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    const folder = tmp();

    // The recorder is open for a Video: its preview has the Cam Link.
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    expect(windows.camerasRunning()).toBe(1);

    client.send({ type: "start-meter" });
    await client.next("meter-started");
    client.send({ type: "start-calibration", folder });
    // One process holds the mic and the camera: the run's, writing both. The
    // preview let the Cam Link go for it.
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    const run = windows.meter()!;
    expect(run.launch.args).toContain("camera.mkv");
    expect(run.launch.args).toContain("video=Cam Link 4K");
    const graph = run.launch.args.join(" ");
    // The recording's own stamping and mic timing, so the Mic Offset is the
    // recording's.
    const t0 =
      /\[0:v\]setpts=PTS-([\d.]+)\/TB,fps=30000\/1001:start_time=0/.exec(
        graph
      )?.[1];
    expect(t0).toBeDefined();
    expect(graph).toContain(`${micOnClock(t0!)},ebur128`);
    expect(windows.cameraPreviews.filter((p) => p.running)).toHaveLength(0);

    // It is started once live: its first reading, after the camera opened.
    run.stderr(`${ebur128Line(4.6, -60, -60)}\r\n`);
    const started = await client.next("calibration-started");
    expect(started.micFile).toMatch(
      new RegExp(`^${folder}/av-calibrations/[^/]+/mic\\.wav$`)
    );
    expect(started.cameraFile).toBe(
      path.join(path.dirname(started.micFile), "camera.mkv")
    );
    expect(started.camera).toBe("Cam Link 4K");
    expect(started.scriptStartSeconds).toBeGreaterThanOrEqual(4.6);
    expect(fs.existsSync(path.dirname(started.micFile))).toBe(true);
    expect(await client.next("meter-reading")).toMatchObject({ seconds: 4.6 });

    // Record is refused while it runs.
    client.send({
      type: "record",
      silenceLength: "short",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect((await client.next("refused")).message).toBe(RECORD_WHILE_METERING);

    client.send({
      type: "finish-calibration",
      silence: { startSeconds: 3.75, endSeconds: 12.25 },
      speech: [
        { startSeconds: 13.75, endSeconds: 19.75 },
        { startSeconds: 23.75, endSeconds: 29.75 },
      ],
      claps: { startSeconds: 20, endSeconds: 23 },
    });
    expect(await client.next("calibration-measured")).toEqual({
      type: "calibration-measured",
      calibrationId: started.calibrationId,
      mic: "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)",
      micFile: started.micFile,
      camera: "Cam Link 4K",
      cameraFile: started.cameraFile,
      noiseFloorDb: -97.3,
      speechLufs: -27.4,
      truePeakDb: -9.2,
    });
    const analysis = windows.launched.find((l) =>
      l.args.some((a) => a.includes("astats="))
    );
    const analysed = analysis?.args.join(" ");
    expect(analysed).toContain("atrim=start=3.75:end=12.25,astats=");
    expect(analysed).toContain("concat=n=2:v=0:a=1,ebur128");
    // The true peak is over the take with the clap window cut out.
    expect(analysed).toContain("[pa]atrim=end=20,");
    expect(analysed).toContain("[pb]atrim=start=23,");
    expect(analysed).toContain(
      "[p0][p1]concat=n=2:v=0:a=1,ebur128=peak=true:framelog=quiet,anullsink"
    );
    // Both processes' ffmpeg logs are kept beside the files.
    const runDir = path.dirname(started.micFile);
    expect(
      fs.readFileSync(path.join(runDir, "ffmpeg-capture.log"), "utf8")
    ).toContain(ebur128Line(4.6, -60, -60));
    expect(
      fs.readFileSync(path.join(runDir, "ffmpeg-analysis.log"), "utf8")
    ).toContain("RMS level dB");
    // The run is over, the plain meter is back, and so is the preview.
    expect(run.running).toBe(false);
    expect(windows.meter()?.launch.args).not.toContain("mic.wav");
    await vi.waitFor(() =>
      expect(windows.cameraPreviews.filter((p) => p.running)).toHaveLength(1)
    );

    // A cancelled run deletes its folder.
    client.send({ type: "start-calibration", folder });
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    windows.meter()!.stderr(`${ebur128Line(3.1, -60, -60)}\r\n`);
    const cancelled = await client.next("calibration-started");
    client.send({ type: "cancel-calibration" });
    expect(await client.next("calibration-ended")).toEqual({
      type: "calibration-ended",
      calibrationId: cancelled.calibrationId,
      message: null,
    });
    expect(fs.existsSync(path.dirname(cancelled.micFile))).toBe(false);
    expect(fs.existsSync(path.dirname(started.micFile))).toBe(true);
  });

  it("refuses to start a run whose camera never goes live, and keeps nothing", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    const folder = tmp();
    client.send({ type: "start-meter" });
    await client.next("meter-started");
    client.send({ type: "start-calibration", folder });
    expect(await client.next("refused")).toMatchObject({
      command: "start-calibration",
      message: CAM_LINK_NOT_STARTING,
    });
    expect(fs.readdirSync(path.join(folder, "av-calibrations"))).toEqual([]);
    // The plain meter is back.
    expect(windows.meter()?.launch.args).not.toContain("mic.wav");
  });

  it("refuses to start a run while another program holds the Cam Link, says Close OBS to calibrate, keeps nothing, and starts once it is freed", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    const folder = tmp();
    client.send({ type: "start-meter" });
    await client.next("meter-started");

    client.send({ type: "start-calibration", folder });
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    // What dshow says when OBS has the Cam Link: a synthetic error, no device.
    const busy = windows.meter()!;
    busy.stderr(
      "[dshow @ 0001] [error] Could not run graph (sometimes caused by a device already in use by other application)\r\n" +
        "[in#1 @ 0002] [error] Error opening input: I/O error\r\n"
    );
    busy.exit(1);
    expect(await client.next("refused")).toMatchObject({
      command: "start-calibration",
      message: CLOSE_OBS_TO_CALIBRATE,
    });
    expect(fs.readdirSync(path.join(folder, "av-calibrations"))).toEqual([]);
    expect(windows.meter()?.launch.args).not.toContain("mic.wav");

    // OBS lets go: Start runs.
    client.send({ type: "start-calibration", folder });
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    windows.meter()!.stderr(`${ebur128Line(3.4, -60, -60)}\r\n`);
    expect(await client.next("calibration-started")).toMatchObject({
      camera: "Cam Link 4K",
    });
  });

  it("marks each clap in the clap window as the mic hears it, and seen when the camera saw its hands meet, by the result's own rules", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    client.send({ type: "start-meter" });
    await client.next("meter-started");
    client.send({ type: "start-calibration", folder: tmp() });
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    const run = windows.meter()!;
    // The capture reads its camera's motion, as the offline pass reads the file.
    expect(run.launch.args.join(" ")).toContain(
      "scale=320:180,format=gray,tblend=all_mode=difference,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG,nullsink"
    );
    run.stderr(`${ebur128Line(4.6, -60, -60)}\r\n`);
    const started = await client.next("calibration-started");
    const window = runMeasurementWindows(started.scriptStartSeconds).claps;
    // Three claps in the window (more than the one prompted: every clap the
    // mic hears is marked); the camera sees the first two meet, 50 ms after
    // the mic.
    const clapsS = [1, 2.5, 4].map((s) => window.startSeconds + s);
    const contactsS = clapsS.slice(0, 2).map((s) => s + 0.05);

    // Half a second after the first clap: heard, and seen.
    const firstAt = clapsS[0]! + 0.5;
    writeMic(started.micFile, clapsS, firstAt);
    run.stderr(motionLines(contactsS, 0, firstAt));
    run.stderr(`${ebur128Line(firstAt, -30, -30)}\r\n`);
    const first = await client.next("calibration-claps");
    expect(first.calibrationId).toBe(started.calibrationId);
    expect(first.claps).toHaveLength(1);
    expect(first.claps[0]!.audioS).toBeCloseTo(clapsS[0]!, 3);
    expect(first.claps[0]!.seen).toBe(true);

    // The rest of the window: the third clap is heard, but the camera saw
    // no hands meet, so it does not count.
    writeMic(started.micFile, clapsS, window.endSeconds + 1);
    run.stderr(motionLines(contactsS, firstAt, window.endSeconds + 1));
    run.stderr(`${ebur128Line(window.endSeconds + 1, -30, -30)}\r\n`);
    const all = await client.next("calibration-claps");
    expect(all.claps.map((c) => c.seen)).toEqual([true, true, false]);
    all.claps.forEach((c, i) => expect(c.audioS).toBeCloseTo(clapsS[i]!, 3));
    // The motion lines printed after an error never stand in for why the
    // capture quit.
    run.stderr("[vost#1:0 @ 0001] [error] Error submitting a packet\r\n");
    run.stderr(motionLines([], window.endSeconds + 1, window.endSeconds + 2));
    run.exit(1);
    expect((await client.next("calibration-ended")).message).toContain(
      "Error submitting a packet"
    );
  });
});
