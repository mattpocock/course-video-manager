import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_TAG,
  cameraCaptureArgs,
  METER_TAG,
  PREVIEW_TAGS,
} from "./capture-args";
import { quitProcess } from "./camera";
import { STREAM_TAG } from "./stream-args";
import { fakeFootage, fakeWindows } from "./test-utils/fake-windows";
import { connect, recordOnce, start, tmp } from "./test-utils/service-harness";

/**
 * Start-up after a crash, through the recorder service's WebSocket on a
 * scripted Windows (`test-utils/fake-windows.ts`): what a service that died
 * left behind, on disk and on Windows. Nothing here opens a real device.
 */

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
        args: [
          "-Tags",
          `${PREVIEW_TAGS.camera},${PREVIEW_TAGS.screen},${CAPTURE_TAG},${METER_TAG},${STREAM_TAG},cvm-recorder-${recordingSessionId}`,
        ],
      })
    );

    // Once repaired, a later start leaves it alone.
    const again = await start(fakeWindows(), crashed.stateDir);
    expect((await (await connect(again.port)).next("hello")).recovered).toEqual(
      []
    );
  });

  it("stops the previews a service that died left holding the Cam Link", async () => {
    const windows = fakeWindows();
    const crashed = await start(windows);
    const client = await connect(crashed.port);
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    await vi.waitFor(() => expect(windows.screenPreviews).toHaveLength(1));
    // A preview never exits by itself, so after a crash it would keep the
    // Cam Link until killed.
    const left = [...windows.cameraPreviews, ...windows.screenPreviews];

    const next = await start(windows, crashed.stateDir);
    await (await connect(next.port)).next("hello");
    expect(left.map((p) => p.running)).toEqual([false, false]);
  });

  it("recovers every other Recording Session past one whose log ends in a torn line", async () => {
    const crashed = await recordOnce();
    const good = crashed.started.recordingSessionId;
    // A second Recording Session cut off mid-write by a power cut.
    const index = path.join(crashed.stateDir, "recording-sessions.jsonl");
    const goodLog = fs.readFileSync(
      (JSON.parse(fs.readFileSync(index, "utf8")) as { eventLog: string })
        .eventLog,
      "utf8"
    );
    const tornLog = path.join(tmp(), "events.jsonl");
    fs.writeFileSync(
      tornLog,
      `${goodLog.replaceAll(good, "torn")}{"type":"speech-sta`
    );
    fs.appendFileSync(
      index,
      `${JSON.stringify({ recordingSessionId: "torn", eventLog: tornLog })}\n`
    );

    const { port } = await start(fakeWindows(), crashed.stateDir);
    const client = await connect(port);
    expect((await client.next("hello")).recovered).toEqual([good, "torn"]);
    client.send({ type: "replay", recordingSessionId: "torn", afterSeq: 0 });
    await client.next("recording-crashed");
    await client.next("replay-done");
  });
});

describe("a camera capture that ignores q", () => {
  afterEach(() => void vi.useRealTimers());

  it("is stopped on Windows by its tag, not only killed on the WSL side", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const windows = fakeWindows({ cameraTries: ["stuck"] });
    const capture = windows.launch({
      tool: "ffmpeg",
      args: cameraCaptureArgs({
        camera: "Cam Link 4K",
        mic: "Mic",
        relays: { preview: 1, writer: 2 },
      }),
      cwd: "/mnt/c",
    });
    const quitting = quitProcess(capture, {
      launch: windows.launch,
      tag: CAPTURE_TAG,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await quitting;
    expect(windows.camerasRunning()).toBe(0);
  });
});
