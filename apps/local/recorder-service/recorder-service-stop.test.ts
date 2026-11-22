import { describe, expect, it, vi } from "vitest";
import { fakeWindows } from "./test-utils/fake-windows";
import {
  CALIBRATED,
  clock,
  connect,
  start,
  T0_MS,
  tmp,
} from "./test-utils/service-harness";

/**
 * Stop as OBS stops (#2211), through the recorder service's WebSocket on a
 * scripted Windows (test-utils/service-harness.ts): the recorder is open
 * again at once, and the take closes its files in the background, keeping
 * everything up to the press.
 */

/** One -progress block from the writer: it has written `seconds` of both files. */
const written = (seconds: number) =>
  `frame=${Math.ceil((seconds * 30000) / 1001)}\nout_time_us=${seconds * 1_000_000}\nprogress=continue\n`;

const recording = async (onBusyChanged?: (busy: boolean) => void) => {
  const windows = fakeWindows();
  const { port } = await start(windows, tmp(), { onBusyChanged });
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
  client.send({ type: "record", silenceLength: "long", folder, ...CALIBRATED });
  const started = await client.next("recording-started");
  return { windows, client, folder, started };
};

describe("Stop", () => {
  it("opens the recorder at once, and quits the writer only once it has written up to the press", async () => {
    const { windows, client, started } = await recording();
    const writer = windows.recorder("camera");
    // Five seconds in, the writer runs two seconds behind (NVENC opening, a
    // slow disk): the end of the take is still in the relay's queue.
    clock.ms = T0_MS + 5_000;
    writer.stdout(written(3));

    client.received.length = 0;
    client.send({ type: "stop" });
    const open = await client.next(
      "state",
      (m) => m.state.kind === "open" && m.state.videoId === "video-1"
    );
    expect(open.state).toMatchObject({ camera: { kind: "live" } });
    expect(client.received.map((m) => m.type)).not.toContain(
      "recording-stopped"
    );

    // Past the tail, still behind: not quit, so nothing queued is lost, and
    // the relay is still its own (no next writer yet).
    await new Promise((r) => setTimeout(r, 400));
    expect(writer.written).not.toContain("q");
    expect(windows.armedWriters()).toHaveLength(0);

    writer.stdout(written(4.9));
    await new Promise((r) => setTimeout(r, 50));
    expect(writer.written).not.toContain("q");

    // Caught up past the press: quit, the files close, and only then is
    // the take said to have stopped.
    writer.stdout(written(5.1));
    const stopped = await client.next("recording-stopped");
    expect(stopped).toMatchObject({
      reason: "requested",
      recordingSessionId: started.recordingSessionId,
      fileTime: 5.1,
      errors: [],
    });
    expect(writer.written).toContain("q");
    expect(writer.running).toBe(false);
    // The relay is free: the next take's writer is armed on it.
    await vi.waitFor(() => expect(windows.armedWriters()).toHaveLength(1));
    // The devices and the preview never noticed.
    expect(windows.cameraCaptures).toHaveLength(1);
    expect(windows.cameraPreviews).toHaveLength(1);
  });

  it("lets a Record straight after Stop wait for the last take's writer to let the relay go", async () => {
    const { windows, client, folder, started } = await recording();
    const first = windows.recorder("camera");
    clock.ms = T0_MS + 2_000;
    first.stdout(written(1));

    client.received.length = 0;
    client.send({ type: "stop" });
    await client.next("state", (m) => m.state.kind === "open");
    client.send({
      type: "record",
      silenceLength: "long",
      folder,
      ...CALIBRATED,
    });
    await new Promise((r) => setTimeout(r, 400));
    // Still the first take's relay: no second writer listens on it yet.
    expect(
      client.received.filter((m) => m.type === "recording-started")
    ).toHaveLength(0);
    expect(windows.armedWriters()).toHaveLength(0);

    first.stdout(written(2.1));
    const second = await client.next("recording-started");
    expect(second.recordingSessionId).not.toBe(started.recordingSessionId);
    expect(windows.recorder("camera")).not.toBe(first);
    expect(first.running).toBe(false);
    // The first take's stop still arrives, after the second take began, and
    // the state follows the take now recording.
    const stopped = await client.next("recording-stopped");
    expect(stopped.recordingSessionId).toBe(started.recordingSessionId);
    const state = await client.next(
      "state",
      (m) => m.state.kind === "recording"
    );
    expect(state.state).toMatchObject({
      recordingSessionId: second.recordingSessionId,
    });
  });

  it("is busy from Record until the take's files are closed, so the filming check never says done early", async () => {
    const busy: boolean[] = [];
    const { windows, client } = await recording((b) => busy.push(b));
    expect(busy).toEqual([true]);
    const writer = windows.recorder("camera");
    clock.ms = T0_MS + 3_000;
    writer.stdout(written(2));

    client.send({ type: "stop" });
    await client.next("state", (m) => m.state.kind === "open");
    // Open again at once, but the take is still writing its files.
    await new Promise((r) => setTimeout(r, 100));
    expect(busy).toEqual([true]);

    writer.stdout(written(3.1));
    await client.next("recording-stopped");
    await vi.waitFor(() => expect(busy).toEqual([true, false]));
  });
});
