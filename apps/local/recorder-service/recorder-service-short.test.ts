import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeFootage, fakeWindows } from "./test-utils/fake-windows";
import { connect, start, tmp, CALIBRATED } from "./test-utils/service-harness";

/**
 * A Short, through the recorder service's WebSocket on a scripted Windows:
 * the Spacedesk display as its screen, woken by a fake wake (never the real
 * Spacedesk), and camera + mic only when that display cannot be used.
 */

const argsOf = (l: { tool: string; args?: readonly string[] }) =>
  (l.args ?? []).join(" ");

const openShort = async (windows = fakeWindows()) => {
  const s = await start(windows);
  const client = await connect(s.port);
  await client.next("hello");
  client.send({ type: "open", videoId: "short-1", format: "short" });
  const settled = await client.next(
    "state",
    (m) =>
      m.state.kind === "open" &&
      m.state.screen !== null &&
      m.state.screen.kind !== "waking"
  );
  await client.camera("live");
  const screen = settled.state.kind === "open" ? settled.state.screen : null;
  return { ...s, client, screen };
};

describe("a Short", () => {
  it("wakes Spacedesk when its display is not listed, still takes a 1920x1080 one (previewed at its own size), and records its output as the screen", async () => {
    const { windows, client, screen } = await openShort();
    // Waking first, while the camera opens beside it.
    expect(
      client.received.some(
        (m) =>
          m.type === "state" &&
          m.state.kind === "open" &&
          m.state.screen?.kind === "waking"
      )
    ).toBe(true);
    expect(screen).toEqual({ kind: "ready" });
    expect(windows.wakes()).toBe(1);
    expect(argsOf(windows.screenPreviews.at(-1)!.launch)).toMatch(
      /ddagrab=output_idx=2:framerate=60,scale_d3d11=format=nv12:out_range=tv:out_color_matrix=bt709,setparams=/
    );

    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    const started = await client.next("recording-started");
    expect(started).toMatchObject({ format: "short", screenCaptured: true });
    expect(argsOf(windows.recorder("screen").launch)).toContain(
      "ddagrab=output_idx=2:framerate=60:"
    );
    client.send({ type: "stop" });
    expect((await client.next("recording-stopped")).exitCodes).toEqual({
      screen: 0,
      camera: 0,
    });
  });

  it("takes a 1080x1080 display as the screen, previews it at its own size, and records its output", async () => {
    const { windows, client, screen } = await openShort(
      fakeWindows({ spacedesk: { width: 1080, height: 1080 } })
    );
    expect(screen).toEqual({ kind: "ready" });
    expect(argsOf(windows.screenPreviews.at(-1)!.launch)).toMatch(
      /ddagrab=output_idx=2:framerate=60,scale_d3d11=format=nv12:out_range=tv:out_color_matrix=bt709,setparams=/
    );

    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect(await client.next("recording-started")).toMatchObject({
      format: "short",
      screenCaptured: true,
    });
    expect(argsOf(windows.recorder("screen").launch)).toContain(
      "ddagrab=output_idx=2:framerate=60:"
    );
    client.send({ type: "stop" });
    await client.next("recording-stopped");
  });

  it("does not wake Spacedesk when its display is already listed", async () => {
    const { windows, screen } = await openShort(
      fakeWindows({ spacedesk: { width: 1920, height: 1080, awake: true } })
    );
    expect(screen).toEqual({ kind: "ready" });
    expect(windows.wakes()).toBe(0);
  });

  it("with a display that is neither square nor 16:9: unavailable naming its size, scenes that show the screen refused, Camera records camera and mic only", async () => {
    const { windows, client, screen } = await openShort(
      fakeWindows({ spacedesk: { width: 1080, height: 1920, awake: true } })
    );
    expect(screen).toMatchObject({ kind: "unavailable" });
    const message = screen?.kind === "unavailable" ? screen.message : "";
    expect(message).toContain("1080x1920");
    expect(message).toContain("set Spacedesk to 1080x1080");
    expect(windows.screenPreviews).toEqual([]);

    // The service starts in Code, which shows the screen.
    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect((await client.next("refused")).message).toContain(message);
    client.send({ type: "switch-scene", scene: "No Face" });
    expect(await client.next("refused")).toMatchObject({
      command: "switch-scene",
      message: expect.stringContaining("1080x1920"),
    });
    client.send({
      type: "stream-deck",
      press: { action: "switch-scene", scene: "Code" },
    });
    expect((await client.next("stream-deck-ignored")).message).toContain(
      "1080x1920"
    );

    client.send({ type: "switch-scene", scene: "Camera" });
    await client.next(
      "state",
      (m) => m.state.kind === "open" && m.state.scene === "Camera"
    );
    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    const started = await client.next("recording-started");
    expect(started).toMatchObject({ format: "short", screenCaptured: false });
    expect(started.files.screen).toMatch(/screen\.mkv$/);
    expect(windows.recorders.map((r) => argsOf(r.launch))).toEqual([
      expect.stringContaining("camera.mkv"),
    ]);
    expect(
      windows.launched.some(
        (l) => l.tool === "powershell" && l.script === "timer-resolution.ps1"
      )
    ).toBe(false);

    client.send({ type: "stop" });
    const stopped = await client.next("recording-stopped");
    expect(stopped).toMatchObject({
      reason: "requested",
      exitCodes: { screen: null, camera: 0 },
      framesLost: { screen: null },
    });
    expect(fs.existsSync(started.files.screen)).toBe(false);
  });

  it("when the wake fails: unavailable with the reason; retry-screen wakes it and recovers", async () => {
    const windows = fakeWindows({ wakeFails: "timed out after 8 s" });
    const { client, screen } = await openShort(windows);
    expect(screen).toEqual({
      kind: "unavailable",
      message: "Could not wake Spacedesk: timed out after 8 s",
    });

    windows.spacedesk.wakeFails = undefined;
    client.send({ type: "retry-screen" });
    await client.next(
      "state",
      (m) => m.state.kind === "open" && m.state.screen?.kind === "ready"
    );
    expect(windows.wakes()).toBe(2);
    expect(argsOf(windows.screenPreviews.at(-1)!.launch)).toContain(
      "output_idx=2"
    );
  });

  it("re-opened for Landscape, previews the DELL and records it as before", async () => {
    const { windows, client } = await openShort();
    client.send({ type: "open", videoId: "landscape-1" });
    await client.next(
      "state",
      (m) =>
        m.state.kind === "open" &&
        m.state.format === "landscape" &&
        m.state.screen === null
    );
    await new Promise((r) => setTimeout(r, 50));
    const running = windows.screenPreviews.filter((p) => p.running);
    expect(running.map((p) => argsOf(p.launch))).toEqual([
      expect.stringMatching(
        /output_idx=1:framerate=60,scale_d3d11=format=nv12:out_range=tv:out_color_matrix=bt709,setparams=/
      ),
    ]);
    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect(await client.next("recording-started")).toMatchObject({
      format: "landscape",
      screenCaptured: true,
    });
    expect(argsOf(windows.recorder("screen").launch)).toContain(
      "output_idx=1:"
    );
  });

  it("recovers a camera-only Recording Session cut off by a crash, its screen missing", async () => {
    const crashed = await openShort(fakeWindows({ wakeFails: "unreachable" }));
    crashed.client.send({ type: "switch-scene", scene: "Camera" });
    crashed.client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    const { files, recordingSessionId } =
      await crashed.client.next("recording-started");
    fs.writeFileSync(files.camera, fakeFootage(8));
    fs.writeFileSync(files.mic, fakeFootage(8, { unfinished: true }));

    const again = await start(fakeWindows(), crashed.stateDir);
    const client = await connect(again.port);
    expect((await client.next("hello")).recovered).toEqual([
      recordingSessionId,
    ]);
    client.send({ type: "replay", recordingSessionId, afterSeq: 0 });
    expect((await client.next("recording-crashed")).repairs).toEqual({
      camera: "readable",
      screen: "missing",
      mic: "remuxed",
    });
  });
});
