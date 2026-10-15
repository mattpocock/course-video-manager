import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

/**
 * LOAD SAMPLES (load-sampler.ts): the PC's load once a second while the
 * capture runs, in each take's ffmpeg-capture.log.
 */
describe("load samples", () => {
  it("starts one load-sampler.ps1 with the capture, by its tag, and writes its samples into the take's ffmpeg-capture.log", async () => {
    const { windows, client, started } = await recordOnce();
    expect(windows.loadSamplers.map((p) => p.launch.args)).toEqual([
      ["-Tag", CAPTURE_TAG],
    ]);
    const [sampler] = windows.loadSamplers;
    sampler!.stdout("87\t6.1\t0.98\t45\t12\t30\r\n");
    // No nvidia-smi: the GPU columns are empty.
    sampler!.stdout("40\t2.0\t0.32\t\t\t\r\n");
    sampler!.stdout("not a sample\r\n");
    client.send({ type: "stop" });
    await client.next("recording-stopped");
    // After the take: not in its log.
    sampler!.stdout("99\t9.9\t1.58\t99\t99\t99\r\n");
    const log = fs.readFileSync(
      path.join(path.dirname(started.files.mic), "ffmpeg-capture.log"),
      "utf8"
    );
    const loads = log.split("\n").filter((l) => l.startsWith("[load]"));
    expect(loads).toHaveLength(2);
    expect(loads[0]).toMatch(
      /^\[load\] \d{4}-\d\d-\d\dT[\d:.]+Z cpu 87% capture 6\.1% \(0\.98 cores\) wsl (\d+%|\?) gpu 45% enc 12% dec 30%$/
    );
    expect(loads[1]).toMatch(/cpu 40% .* gpu \? enc \? dec \?$/);
    expect(log).not.toContain("cpu 99%");
  });

  it("stops the sampler when the camera is let go", async () => {
    const { windows, client } = await recordOnce();
    client.send({ type: "stop" });
    await client.next("recording-stopped");
    client.send({ type: "close" });
    await vi.waitFor(() =>
      expect(windows.loadSamplers.every((p) => !p.running)).toBe(true)
    );
  });
});
