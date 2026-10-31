import { describe, expect, it, vi } from "vitest";
import { fakeWindows } from "recorder-service/test-utils/fake-windows";
import { ready, setupGoLiveTests } from "./go-live-test-harness";

/**
 * A streamed Recording Session's raw footage, end to end through Go Live
 * (`go-live-test-harness.ts`, #2482): raw footage first.
 */

setupGoLiveTests();

describe("a streamed Recording Session records from T0", () => {
  it("records its camera and mic when the writer Go Live armed at Record is slow to bring its graph up", async () => {
    // ffmpeg 8 drops a command sent before its filter graph is up: a T0
    // sent then left camera.mkv and mic.mkv empty for the whole take.
    const r = await ready({ windows: fakeWindows({ writerGraphMs: 300 }) });

    await r.goLive();

    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-started")
    );
    await vi.waitFor(() =>
      expect(r.windows.recorder("camera").written).toMatch(/^Call \d/m)
    );
    expect(r.heard.map((m) => m.type)).not.toContain("recording-stopped");
  });
});
