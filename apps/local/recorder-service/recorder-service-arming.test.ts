import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fakeWindows } from "./test-utils/fake-windows";
import { CALIBRATED, connect, start, tmp } from "./test-utils/service-harness";

/**
 * The next take's writer, armed before Record (#2207), through the recorder
 * service's WebSocket on a scripted Windows (test-utils/service-harness.ts).
 */

describe("a Recording Session", () => {
  it("starts with nothing to look up or open: the devices the capture opened, the screen found at open, a writer armed (#2207)", async () => {
    const windows = fakeWindows();
    const { port } = await start(windows);
    const client = await connect(port);
    const folder = tmp();
    client.send({ type: "open", videoId: "video-1" });
    client.send({
      type: "prepare-record",
      videoId: "video-1",
      silenceLength: "long",
      folder,
      ...CALIBRATED,
    });
    await client.camera("live");
    await vi.waitFor(() => expect(windows.armedWriters()).toHaveLength(1));
    const [armed] = windows.armedWriters();
    await vi.waitFor(() =>
      expect(
        windows.launched.filter(
          (l) => l.tool === "powershell" && l.script === "screens.ps1"
        )
      ).toHaveLength(1)
    );
    const launchedBefore = windows.launched.length;

    client.send({
      type: "record",
      silenceLength: "long",
      folder,
      ...CALIBRATED,
    });
    await client.next("recording-started");
    // No device listing, no screen listing, no capture: the armed writer
    // hears T0, and only the screen recorder (and its timer tune) starts.
    const launchedAtRecord = windows.launched.slice(launchedBefore);
    expect(
      launchedAtRecord.map((l) =>
        l.tool === "powershell"
          ? l.script
          : l.args.find((a) => a.endsWith(".mkv"))
      )
    ).toEqual(["screen.mkv", "timer-resolution.ps1"]);
    expect(windows.recorder("camera")).toBe(armed);
  });

  it("arms the next take's writer as soon as one stops, and a Record with other settings arms its own", async () => {
    const windows = fakeWindows();
    const { port } = await start(windows);
    const client = await connect(port);
    const folder = tmp();
    client.send({ type: "open", videoId: "video-1" });
    client.send({
      type: "prepare-record",
      videoId: "video-1",
      silenceLength: "long",
      folder,
      ...CALIBRATED,
    });
    await client.camera("live");
    await vi.waitFor(() => expect(windows.armedWriters()).toHaveLength(1));
    const [first] = windows.armedWriters();

    // Another Silence Length than the armed writer's: it makes way.
    client.send({
      type: "record",
      silenceLength: "short",
      folder,
      ...CALIBRATED,
    });
    const started = await client.next("recording-started");
    const cwd = (p: (typeof windows.recorders)[number]) =>
      p.launch.tool === "ffmpeg" ? p.launch.cwd : "";
    expect(first!.running).toBe(false);
    expect(fs.existsSync(cwd(first!))).toBe(false);
    expect(windows.recorder("camera").launch.args.join(" ")).toContain(
      "silencedetect=n=-38dB:d=0.8"
    );

    client.send({ type: "stop" });
    await client.next("recording-stopped");
    await vi.waitFor(() => expect(windows.armedWriters()).toHaveLength(1));
    const armed = windows.armedWriters()[0]!;
    expect(armed.launch.args.join(" ")).toContain("silencedetect=n=-38dB:d=2");

    // Closing quits it and leaves no folder of it behind.
    client.send({ type: "close" });
    await client.next("state", (m) => m.state.kind === "closed");
    await vi.waitFor(() => expect(fs.existsSync(cwd(armed))).toBe(false));
    expect(fs.readdirSync(folder)).toEqual([
      path.basename(path.dirname(started.files.camera)),
    ]);
  });

  it("records from T0 with a writer armed at Record whose graph is slow to come up (#2482)", async () => {
    // ffmpeg 8 drops a command sent before its filter graph is up: a T0
    // sent then left camera.mkv and mic.mkv empty for the whole take.
    const windows = fakeWindows({ writerGraphMs: 300 });
    const { port } = await start(windows);
    const client = await connect(port);
    const folder = tmp();
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");

    // Nothing armed yet: Record arms its writer on the spot.
    client.send({
      type: "record",
      silenceLength: "short",
      folder,
      ...CALIBRATED,
    });
    await client.next("recording-started");

    await vi.waitFor(() =>
      expect(windows.recorder("camera").written).toMatch(/^Call \d/m)
    );
  });
});
