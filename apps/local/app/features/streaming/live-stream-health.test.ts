import { describe, expect, it } from "vitest";
import type { StreamHealth } from "recorder-service/stream-protocol";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialLiveStreamState,
  goLiveControl,
  liveStreamReducer,
} from "./live-stream-reducer";
import { streamHealthLine } from "./stream-health-line";

/**
 * The Live Stream's health line and reconnect state on the Live Stream
 * surface (spec #2445, stories 46–48): what the recorder says, drawn.
 */

const VIDEO = "video-1";

const health = (o: Partial<StreamHealth> = {}): StreamHealth => ({
  fps: 60.02,
  speed: 1.003,
  droppedFrames: 0,
  duplicatedFrames: 0,
  bitrateKbps: 9_160,
  reconnects: 0,
  ...o,
});

const liveOn = (kind: "connecting" | "live" | "reconnecting" = "live") =>
  new ReducerTester(liveStreamReducer, createInitialLiveStreamState()).send({
    type: "stream-status-heard",
    videoId: VIDEO,
    status: { kind },
  });

describe("the Live Stream's health line", () => {
  it("shows the state, fps, speed, drops, dups, bitrate and reconnect count the recorder last said", () => {
    const tester = liveOn().send({
      type: "stream-health-heard",
      videoId: VIDEO,
      health: health({ droppedFrames: 3, duplicatedFrames: 1 }),
    });

    expect(streamHealthLine(tester.getState(), VIDEO)).toBe(
      "Live · 60.0 fps · 1.00x · 3 dropped · 1 duplicated · 9.2 Mb/s · 0 reconnects"
    );
  });

  it("says it is reconnecting, and counts each reconnect, while the recording carries on", () => {
    const tester = liveOn()
      .send({ type: "stream-health-heard", videoId: VIDEO, health: health() })
      .send({
        type: "stream-status-heard",
        videoId: VIDEO,
        status: { kind: "reconnecting" },
      })
      .send({
        type: "stream-health-heard",
        videoId: VIDEO,
        health: health({ bitrateKbps: 0, reconnects: 1 }),
      });

    expect(streamHealthLine(tester.getState(), VIDEO)).toBe(
      "Reconnecting · 60.0 fps · 1.00x · 0 dropped · 0 duplicated · 0.0 Mb/s · 1 reconnect"
    );
    // Reconnecting is not ending: the button is still End Stream.
    expect(goLiveControl(tester.getState(), VIDEO).press).toBe("end-stream");

    tester
      .send({
        type: "stream-status-heard",
        videoId: VIDEO,
        status: { kind: "live" },
      })
      .send({
        type: "stream-health-heard",
        videoId: VIDEO,
        health: health({ reconnects: 2 }),
      });

    expect(streamHealthLine(tester.getState(), VIDEO)).toMatch(
      /^Live · .* · 2 reconnects$/
    );
  });

  it("shows only the state until the stream process has said how it is doing", () => {
    expect(streamHealthLine(liveOn("connecting").getState(), VIDEO)).toBe(
      "Connecting"
    );
  });

  it("shows nothing once the Live Stream has ended, nor for another Video", () => {
    const tester = liveOn().send({
      type: "stream-health-heard",
      videoId: VIDEO,
      health: health({ reconnects: 4 }),
    });

    expect(streamHealthLine(tester.getState(), "another-video")).toBeNull();

    tester.send({
      type: "stream-status-heard",
      videoId: VIDEO,
      status: { kind: "ended", reason: "End Stream." },
    });
    expect(streamHealthLine(tester.getState(), VIDEO)).toBeNull();
  });

  it("starts the next Live Stream's line afresh at Go Live", () => {
    const tester = liveOn()
      .send({
        type: "stream-health-heard",
        videoId: VIDEO,
        health: health({ reconnects: 4 }),
      })
      .send({
        type: "stream-status-heard",
        videoId: VIDEO,
        status: { kind: "ended", reason: "End Stream." },
      })
      .send({ type: "go-live-pressed", videoId: VIDEO, silenceLength: "short" })
      .send({
        type: "stream-status-heard",
        videoId: VIDEO,
        status: { kind: "connecting" },
      });

    expect(streamHealthLine(tester.getState(), VIDEO)).toBe("Connecting");
  });
});
