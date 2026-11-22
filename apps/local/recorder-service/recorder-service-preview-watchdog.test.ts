import { describe, expect, it, vi } from "vitest";
import { fakeWindows } from "./test-utils/fake-windows";
import { CALIBRATED, connect, start, tmp } from "./test-utils/service-harness";

/**
 * A preview that stalls while still running, or quits, is started again
 * (#2192): a Short's screen preview once froze at 75 s and stayed frozen
 * until `pnpm dev` restarted. The recording is never touched.
 */
describe("the preview watchdog", () => {
  it("starts a stalled or quit screen preview again, even mid-take, without touching the recording", async () => {
    const windows = fakeWindows();
    const { port } = await start(windows, tmp(), { previewStallMs: 150 });
    const client = await connect(port);
    await client.next("hello");
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    await client.next("recording-started");
    await vi.waitFor(() => expect(windows.screenPreviews).toHaveLength(1));

    // Stalls: still running, sending nothing.
    const stalled = windows.screenPreviews[0]!;
    stalled.frozen = true;
    await vi.waitFor(() => expect(windows.screenPreviews).toHaveLength(2), {
      timeout: 3000,
    });
    expect(stalled.running).toBe(false);

    // Quits.
    windows.screenPreviews[1]!.exit(1);
    await vi.waitFor(() => expect(windows.screenPreviews).toHaveLength(3), {
      timeout: 3000,
    });

    expect(windows.recorder("screen").running).toBe(true);
    expect(windows.recorder("camera").running).toBe(true);
    expect(client.received.some((m) => m.type === "recording-stopped")).toBe(
      false
    );
  });

  it("opens the Cam Link again when its preview stalls while open", async () => {
    const windows = fakeWindows();
    const { port } = await start(windows, tmp(), { previewStallMs: 150 });
    const client = await connect(port);
    await client.next("hello");
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    windows.cameraPreviews[0]!.frozen = true;
    await vi.waitFor(() => expect(windows.cameraPreviews).toHaveLength(2), {
      timeout: 3000,
    });
    expect(windows.cameraPreviews[0]!.running).toBe(false);
    await client.camera("live");
  });
});

/**
 * A preview whose NVENC will not open (every session taken) is started
 * again on libx264. A take's camera preview is camera.mkv's own stream
 * too, so the recording's own NVENC sessions are the only ones it asks for
 * (#2194).
 */
describe("a preview whose NVENC will not open", () => {
  it("moves that feed to libx264, without spending a Cam Link try; a take still asks NVENC only for camera.mkv", async () => {
    const windows = fakeWindows({ nvencBusy: true, cameraTries: ["frames"] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { port } = await start(windows, tmp());
    const client = await connect(port);
    await client.next("hello");
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    await vi.waitFor(() => expect(windows.screenPreviews).toHaveLength(2));

    const encoders = (ps: typeof windows.screenPreviews) =>
      ps.map((p) => (p.launch.args.includes("h264_nvenc") ? "nvenc" : "x264"));
    expect(encoders(windows.cameraPreviews)).toEqual(["nvenc", "x264"]);
    expect(encoders(windows.screenPreviews)).toEqual(["nvenc", "x264"]);
    expect(windows.screenPreviews[1]!.running).toBe(true);
    expect(
      errors.mock.calls.filter((c) =>
        String(c[0]).includes("could not open NVENC")
      )
    ).toHaveLength(2);

    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    await client.next("recording-started");
    const take = windows.recorder("camera").launch.args;
    expect(take.filter((a) => a === "h264_nvenc")).toHaveLength(1);
    expect(take).not.toContain("libx264");
  });
});
