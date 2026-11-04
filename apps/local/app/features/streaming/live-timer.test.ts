import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { StreamStatus } from "recorder-service/stream-protocol";
import {
  createInitialLiveStreamState,
  liveSinceOf,
  liveStreamReducer,
} from "./live-stream-reducer";
import { liveTimer } from "./live-timer";

const LIVE_SINCE = "2026-11-04T18:00:00.000Z";
const at = (offset: string) => Date.parse(LIVE_SINCE) + ms(offset);
const ms = (hms: string) => {
  const [h, m, s] = hms.split(":").map(Number);
  return ((h! * 60 + m!) * 60 + s!) * 1000;
};

const heard = (
  status: StreamStatus,
  liveSince: string | null
): liveStreamReducer.Action => ({
  type: "live-stream-heard",
  stream: { videoId: "v1", status, liveSince },
});

describe("the Live Timer", () => {
  it("counts HH:MM:SS from when the Live Stream first went live, past an hour", () => {
    expect(liveTimer(LIVE_SINCE, at("00:00:00"))).toBe("00:00:00");
    expect(liveTimer(LIVE_SINCE, at("00:00:59") + 999)).toBe("00:00:59");
    expect(liveTimer(LIVE_SINCE, at("00:42:07"))).toBe("00:42:07");
    expect(liveTimer(LIVE_SINCE, at("01:02:03"))).toBe("01:02:03");
    expect(liveTimer(LIVE_SINCE, at("27:00:01"))).toBe("27:00:01");
  });

  it("is null when not live", () => {
    expect(liveTimer(null, at("00:10:00"))).toBeNull();
  });

  it("reads 00:00:00, never a negative count, when this clock is a little behind the app server's", () => {
    expect(liveTimer(LIVE_SINCE, at("00:00:00") - 1500)).toBe("00:00:00");
  });

  it("follows the Live Stream on this Video: nothing while connecting, kept through a reconnect, gone once ended", () => {
    const t = new ReducerTester(
      liveStreamReducer,
      createInitialLiveStreamState()
    );
    const timer = (videoId = "v1") =>
      liveTimer(liveSinceOf(t.getState(), videoId), at("01:30:00"));

    expect(timer()).toBeNull();
    t.send(heard({ kind: "connecting" }, null));
    expect(timer()).toBeNull();

    t.send(heard({ kind: "live" }, LIVE_SINCE));
    expect(timer()).toBe("01:30:00");
    expect(timer("another-video")).toBeNull();

    t.send(heard({ kind: "reconnecting" }, LIVE_SINCE));
    expect(timer()).toBe("01:30:00");
    t.send(heard({ kind: "ending" }, LIVE_SINCE));
    expect(timer()).toBe("01:30:00");

    t.send(heard({ kind: "ended", reason: "End Stream." }, null));
    expect(timer()).toBeNull();
  });
});
