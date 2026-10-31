import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  BUSY_STREAMING,
  BUSY_STREAMING_ANOTHER_VIDEO,
  STREAM_DECK_WHILE_LIVE,
} from "recorder-service/stream-protocol";
import { IDLE_STOP } from "recorder-service/protocol";
import { stopCleanlyOn } from "recorder-service/run-recorder-service";
import { connect } from "recorder-service/test-utils/service-harness";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import { clipService } from "../clip-service-test-setup";
import { ready, setupGoLiveTests } from "./go-live-test-harness";

/**
 * Busy streaming (ADR 0055), end to end (`go-live-test-harness.ts`): while
 * live, only End Stream ends the streamed Recording Session. Nothing else
 * that talks to the recorder service (another Video's editor, the app
 * server's idle stop, the Stream Deck) can stop it or take the recorder.
 */

setupGoLiveTests();

/** Go Live, and wait until the streamed Recording Session records. */
const live = async () => {
  const r = await ready();
  await r.goLive();
  await vi.waitFor(() =>
    expect(r.heard.map((m) => m.type)).toContain("recording-started")
  );
  return r;
};

const isStatus = (
  m: CvmRecorderMessage
): m is Extract<CvmRecorderMessage, { type: "recorder-status" }> =>
  m.type === "recorder-status";

describe("a streamed Recording Session is busy streaming", () => {
  it("refuses Stop, close and opening the recorder for another Video, telling that Video's editor it is busy streaming, and keeps recording", async () => {
    const r = await live();
    const other = await connect(r.port);

    for (const command of [
      { type: "stop" },
      { type: "close" },
      { type: "open", videoId: "another-video", format: "landscape" },
    ] as const) {
      other.send(command);
      expect(
        await other.next("refused", (m) => m.command === command.type)
      ).toMatchObject({ message: BUSY_STREAMING });
    }
    // The editor's own Stop (leaving the page) is refused the same way.
    await expect(r.client.stopRecording(r.video.id)).rejects.toThrow(
      BUSY_STREAMING
    );
    // The live Video's editor knows its Recording Session is streamed;
    // another Video's, that the recorder is busy streaming.
    expect(r.heard.filter(isStatus).at(-1)).toMatchObject({
      recordingSessionId: expect.any(String),
      streamed: true,
    });
    const otherVideo = await clipService.createVideo("Another Video");
    const otherHeard: CvmRecorderMessage[] = [];
    r.client.subscribe(otherVideo.id, (m) => otherHeard.push(m));
    expect(otherHeard.filter(isStatus).at(-1)).toMatchObject({
      problem: BUSY_STREAMING_ANOTHER_VIDEO,
      recordingSessionId: null,
      streamed: false,
    });
    await expect(r.client.stopRecording(otherVideo.id)).rejects.toThrow();

    expect(r.heard.map((m) => m.type)).not.toContain("recording-stopped");
    const screen = r.windows.recorder("screen");
    const writer = r.windows.recorder("camera");
    expect(screen.written).toBe("");
    expect(writer.written).not.toContain("q");
    expect(screen.running && writer.running).toBe(true);

    await r.client.endStream(r.video.id);
    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-stopped")
    );
    await vi.waitFor(() =>
      expect(r.heard.filter(isStatus).at(-1)).toMatchObject({
        recordingSessionId: null,
        streamed: false,
      })
    );
  });

  it("refuses the app server's idle stop while live, and honours it once End Stream is over", async () => {
    const r = await live();
    const ipc = new EventEmitter();
    const lines: string[] = [];
    let stopped = false;
    void stopCleanlyOn({ busy: r.busy, close: async () => {} }, ipc, (line) =>
      lines.push(line)
    ).then(() => (stopped = true));

    expect(r.busy()).toBe(true);
    ipc.emit("message", IDLE_STOP);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    expect(lines.join("\n")).toContain("refused");

    await r.client.endStream(r.video.id);
    await vi.waitFor(() => expect(r.busy()).toBe(false));
    ipc.emit("message", IDLE_STOP);
    await vi.waitFor(() => expect(stopped).toBe(true));
  });

  it("ignores the Stream Deck's Record and Stop, saying why, while its scene keys still act", async () => {
    const r = await live();
    const deck = await connect(r.port);

    for (const action of ["toggle-record", "stop", "record"] as const) {
      deck.send({ type: "stream-deck", press: { action } });
      expect(
        await deck.next("stream-deck-ignored", (m) => m.press.action === action)
      ).toMatchObject({ message: STREAM_DECK_WHILE_LIVE });
    }
    deck.send({
      type: "stream-deck",
      press: { action: "switch-scene", scene: "Camera" },
    });
    await vi.waitFor(() =>
      expect(r.heard).toContainEqual({ type: "scene-changed", scene: "Camera" })
    );
    expect(r.heard.map((m) => m.type)).not.toContain("recording-stopped");
    await r.client.endStream(r.video.id);
  });
});
