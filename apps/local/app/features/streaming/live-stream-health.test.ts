import { describe, expect, it } from "vitest";
import type { StreamHealth } from "recorder-service/stream-protocol";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialLiveStreamState,
  goLiveControl,
  liveStreamReducer,
} from "./live-stream-reducer";
import { streamHealthAmber, streamHealthLine } from "./stream-health-line";

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
  feedOverflows: 0,
  feedsDropping: false,
  ...o,
});

const heard = (kind: "connecting" | "live" | "reconnecting") =>
  ({
    type: "live-stream-heard",
    stream: { videoId: VIDEO, status: { kind } },
  }) as const;

const liveOn = (kind: "connecting" | "live" | "reconnecting" = "live") =>
  new ReducerTester(liveStreamReducer, createInitialLiveStreamState()).send(
    heard(kind)
  );

describe("the Live Stream's health line", () => {
  it("shows the state, fps, speed, drops, dups, bitrate and reconnect count the recorder last said", () => {
    const line = streamHealthLine(
      liveOn().getState(),
      VIDEO,
      health({ droppedFrames: 3, duplicatedFrames: 1 })
    );

    expect(line).toBe(
      "Live · 60.0 fps · 1.00x · 3 dropped · 1 duplicated · 9.2 Mb/s · 0 reconnects"
    );
  });

  it("says it is reconnecting, and counts each reconnect, while the recording carries on", () => {
    const tester = liveOn().send(heard("reconnecting"));

    expect(
      streamHealthLine(
        tester.getState(),
        VIDEO,
        health({ bitrateKbps: 0, reconnects: 1 })
      )
    ).toBe(
      "Reconnecting · 60.0 fps · 1.00x · 0 dropped · 0 duplicated · 0.0 Mb/s · 1 reconnect"
    );
    // Reconnecting is not ending: the button is still End Stream.
    expect(goLiveControl(tester.getState(), VIDEO).press).toBe("end-stream");

    tester.send(heard("live"));
    expect(
      streamHealthLine(tester.getState(), VIDEO, health({ reconnects: 2 }))
    ).toMatch(/^Live · .* · 2 reconnects$/);
  });

  it("goes amber while a feed is dropping packets, counting its overflows, though the encoder's numbers are green (#2525)", () => {
    const tester = liveOn();
    const dropping = health({ feedOverflows: 3, feedsDropping: true });

    expect(streamHealthLine(tester.getState(), VIDEO, dropping)).toBe(
      "Live · 60.0 fps · 1.00x · 0 dropped · 0 duplicated · 9.2 Mb/s · 0 reconnects · 3 feed overflows"
    );
    expect(streamHealthAmber(dropping)).toBe(true);

    // Whole again: the count stays, the amber goes.
    const whole = health({ feedOverflows: 3, feedsDropping: false });
    expect(streamHealthLine(tester.getState(), VIDEO, whole)).toMatch(
      / · 3 feed overflows$/
    );
    expect(streamHealthAmber(whole)).toBe(false);
    expect(streamHealthAmber(null)).toBe(false);
  });

  it("shows only the state until the stream process has said how it is doing", () => {
    expect(streamHealthLine(liveOn("connecting").getState(), VIDEO, null)).toBe(
      "Connecting"
    );
  });

  it("shows nothing once the Live Stream has ended, nor for another Video", () => {
    const tester = liveOn();
    const last = health({ reconnects: 4 });

    expect(
      streamHealthLine(tester.getState(), "another-video", last)
    ).toBeNull();

    tester.send({
      type: "live-stream-heard",
      stream: {
        videoId: VIDEO,
        status: { kind: "ended", reason: "End Stream." },
      },
    });
    expect(streamHealthLine(tester.getState(), VIDEO, last)).toBeNull();
  });
});
