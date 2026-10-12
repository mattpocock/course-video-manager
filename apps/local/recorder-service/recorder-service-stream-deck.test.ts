import { describe, expect, it } from "vitest";
import { connect, start, tmp } from "./test-utils/service-harness";

/**
 * Stream Deck presses, as the forwarder sends them: they act on whichever
 * Video the recorder is open for, and every client hears it as if the
 * app server had asked.
 */

describe("Stream Deck presses", () => {
  it("record, switch scene and stop the Video the recorder is open for, with the Silence Length the app server prepared", async () => {
    const s = await start();
    const app = await connect(s.port);
    const deck = await connect(s.port);
    await app.next("hello");
    const folder = tmp();
    app.send({ type: "open", videoId: "video-1" });
    await app.camera("live");
    app.send({
      type: "prepare-record",
      videoId: "video-1",
      silenceLength: "long",
      folder,
    });

    deck.send({ type: "stream-deck", press: { action: "record" } });
    const started = await app.next("recording-started");
    expect(started).toMatchObject({
      videoId: "video-1",
      silenceLength: "long",
    });
    expect(started.files.mic.startsWith(folder)).toBe(true);

    deck.send({
      type: "stream-deck",
      press: { action: "switch-scene", scene: "Camera" },
    });
    expect(
      await app.next("scene-changed", (m) => m.scene === "Camera")
    ).toMatchObject({ recordingSessionId: started.recordingSessionId });

    deck.send({ type: "stream-deck", press: { action: "stop" } });
    expect(await app.next("recording-stopped")).toMatchObject({
      reason: "requested",
    });
    expect((await app.camera("live")).state).toMatchObject({
      videoId: "video-1",
      scene: "Camera",
    });
    expect(app.received.some((m) => m.type === "stream-deck-ignored")).toBe(
      false
    );
  });

  it("with no recorder open, does nothing and says so to every client", async () => {
    const s = await start();
    const app = await connect(s.port);
    const deck = await connect(s.port);
    await app.next("hello");

    for (const press of [
      { action: "record" },
      { action: "stop" },
      { action: "switch-scene", scene: "No Face" },
    ] as const) {
      deck.send({ type: "stream-deck", press });
      expect(await app.next("stream-deck-ignored")).toMatchObject({
        press,
        message: expect.stringContaining("not open"),
      });
    }
    expect(s.windows.camerasRunning()).toBe(0);
    expect(app.received.filter((m) => m.type === "state")).toEqual([]);
  });

  it("refuses a Stream Deck Record the app server has not prepared for this Video", async () => {
    const s = await start();
    const app = await connect(s.port);
    await app.next("hello");
    app.send({
      type: "prepare-record",
      videoId: "video-1",
      silenceLength: "short",
      folder: tmp(),
    });
    app.send({ type: "open", videoId: "video-2" });
    await app.camera("live");

    app.send({ type: "stream-deck", press: { action: "record" } });
    expect((await app.next("stream-deck-ignored")).message).toContain(
      "Silence Length"
    );
    expect(app.received.some((m) => m.type === "recording-started")).toBe(
      false
    );
  });
});
