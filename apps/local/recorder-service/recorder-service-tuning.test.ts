import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTURE_TAG } from "./capture-args";
import { recordOnce } from "./test-utils/service-harness";

/**
 * TUNING (camera.ts, `tuneProcess`): the camera capture, the take's writer
 * and the screen recorder each run out of power throttling, on a 1 ms timer
 * and at High priority, as OBS runs its own capture. The capture stalls of
 * 2026-10-15 lost camera frames with only High priority on the capture.
 */
describe("tuning the recorders", () => {
  const tunes = (
    launched: { tool: string; script?: string; args: readonly string[] }[]
  ) =>
    launched
      .filter(
        (l) => l.tool === "powershell" && l.script === "timer-resolution.ps1"
      )
      .map((l) => l.args);

  it("tunes the camera capture, the writer and the screen recorder with timer-resolution.ps1, each by its own command line", async () => {
    const { windows, client, started } = await recordOnce();
    client.send({ type: "stop" });
    await client.next("recording-stopped");
    const tag = `cvm-recorder-${started.recordingSessionId}`;
    expect(tunes(windows.launched)).toEqual(
      expect.arrayContaining([
        ["-Tag", CAPTURE_TAG, "-Match", CAPTURE_TAG],
        ["-Tag", tag, "-Match", "camera.mkv"],
        ["-Tag", tag, "-Match", "screen.mkv"],
      ])
    );
    expect(
      windows.launched.some(
        (l) =>
          l.tool === "powershell" &&
          l.script !== "timer-resolution.ps1" &&
          /priority/.test(l.script)
      )
    ).toBe(false);
  });

  it("says in the take's ffmpeg-capture.log how the capture and the writer were tuned, a failure included", async () => {
    const { client, started } = await recordOnce({
      tuneFails: {
        "camera.mkv":
          "expected one ffmpeg.exe matching cvm-recorder-x / camera.mkv, found 0",
      },
    });
    client.send({ type: "stop" });
    await client.next("recording-stopped");
    const log = fs.readFileSync(
      path.join(path.dirname(started.files.mic), "ffmpeg-capture.log"),
      "utf8"
    );
    expect(log).toContain(
      "[cvm] camera capture tuned: timeBeginPeriod(1) in ffmpeg.exe 42, priority High\n"
    );
    expect(log).toContain(
      "[cvm] camera writer NOT tuned (Normal priority, 15.6 ms timer): expected one ffmpeg.exe matching cvm-recorder-x / camera.mkv, found 0\n"
    );
  });
});
