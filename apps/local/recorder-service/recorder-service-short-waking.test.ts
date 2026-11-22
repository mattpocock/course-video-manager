import { describe, expect, it } from "vitest";
import { fakeWindows } from "./test-utils/fake-windows";
import { connect, start, tmp, CALIBRATED } from "./test-utils/service-harness";

/**
 * A Short's screen while Spacedesk wakes, and screen-side restarts that
 * overlap: a fake wake only, never the real Spacedesk.
 */

const answerTo = (client: Awaited<ReturnType<typeof connect>>) =>
  Promise.race([
    client.next("recording-started").then(() => "recording-started"),
    client.next("refused").then((m) => `refused: ${m.message}`),
  ]);

describe("a Short's screen", () => {
  it("is not left waking by an older restart that finishes after a newer one", async () => {
    const windows = fakeWindows({
      spacedesk: { width: 1920, height: 1080, awake: true },
    });
    const s = await start(windows);
    const client = await connect(s.port);
    await client.next("hello");
    client.send({ type: "open", videoId: "landscape-1" });
    await client.camera("live");
    await new Promise((r) => setTimeout(r, 50));
    const dellPreview = windows.screenPreviews.at(-1)!;
    dellPreview.stuck = true;

    // The first restart waits on the stuck DELL preview; two more overtake it.
    client.send({ type: "open", videoId: "short-1", format: "short" });
    client.send({ type: "open", videoId: "landscape-1" });
    client.send({ type: "open", videoId: "short-1", format: "short" });
    await client.next(
      "state",
      (m) => m.state.kind === "open" && m.state.screen?.kind === "ready"
    );
    client.received.splice(0);
    dellPreview.exit(null);
    await new Promise((r) => setTimeout(r, 50));
    // The overtaken restart sets nothing: the Short stays ready.
    expect(client.received.filter((m) => m.type === "state")).toEqual([]);
  });

  it("is waking at once on retry-screen, so a Record right behind it is refused", async () => {
    const windows = fakeWindows({
      spacedesk: { width: 1920, height: 1080, awake: true },
    });
    const s = await start(windows);
    const client = await connect(s.port);
    await client.next("hello");
    client.send({ type: "open", videoId: "short-1", format: "short" });
    await client.next(
      "state",
      (m) => m.state.kind === "open" && m.state.screen?.kind === "ready"
    );
    await client.camera("live");
    const preview = windows.screenPreviews.at(-1)!;
    preview.stuck = true; // slow to quit, as a real ffmpeg.exe flushing

    client.send({ type: "retry-screen" });
    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect(await answerTo(client)).toBe(
      "refused: Spacedesk is still waking: wait for the screen before recording."
    );
    preview.exit(null);
  });

  it("while waking, refuses a Stream Deck switch to a scene that shows the screen, and Record", async () => {
    const windows = fakeWindows();
    windows.wakeSpacedesk = () => new Promise<void>(() => {}); // never answers
    const s = await start(windows);
    const client = await connect(s.port);
    await client.next("hello");
    client.send({ type: "open", videoId: "short-1", format: "short" });
    await client.camera("live");
    client.send({ type: "switch-scene", scene: "Camera" });
    await client.next(
      "state",
      (m) => m.state.kind === "open" && m.state.scene === "Camera"
    );

    client.send({
      type: "stream-deck",
      press: { action: "switch-scene", scene: "Code" },
    });
    expect((await client.next("stream-deck-ignored")).message).toBe(
      "Code shows the screen, and Spacedesk is still waking: wait for the screen."
    );
    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect(await answerTo(client)).toMatch(/Spacedesk is still waking/);
  });
});
