import { describe, expect, it } from "vitest";
import { recordOnce } from "./test-utils/service-harness";

/**
 * Watching the camera + mic process while recording: what counts as the Cam
 * Link lost, and what is some other failure.
 */

describe("the camera while recording", () => {
  it("is lost when the Cam Link sends no frame after Record, even with no progress at all", async () => {
    const { windows, client } = await recordOnce({ recordingCamera: "silent" });
    const lost = await client.next("camera-lost");
    expect(lost.errors.join("\n")).toContain("sent nothing after Record");
    expect((await client.next("recording-stopped")).reason).toBe("camera-lost");
    expect(windows.recorder("camera").running).toBe(false);
  });

  it("is not lost when the camera + mic process quits for the mic or the disk", async () => {
    for (const line of [
      "[in#1/dshow @ 0002] [error] Error during demuxing: I/O error",
      "[out#0/matroska @ 0001] [error] Error submitting a packet to the muxer: No space left on device",
    ]) {
      const { windows, client } = await recordOnce();
      const camera = windows.recorder("camera");
      camera.stderr(`${line}\r\n`);
      camera.exit(1);
      const stopped = await client.next("recording-stopped");
      expect(stopped.reason).toBe("ffmpeg-exited");
      expect(stopped.errors).toContain(line);
      expect(client.received.map((m) => m.type)).not.toContain("camera-lost");
    }
  });
});
