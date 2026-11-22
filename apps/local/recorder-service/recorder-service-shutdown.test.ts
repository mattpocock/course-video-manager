import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IDLE_STOP } from "./protocol";
import { stopCleanlyOn } from "./run-recorder-service";
import { readLog, recordOnce } from "./test-utils/service-harness";

/**
 * Stopping `pnpm dev` mid-take (ADR 0035): the service gets SIGINT/SIGTERM
 * (or loses `pnpm dev` from under it) while recording, and must close the
 * take's files before it exits. The signals are an emitter standing in for
 * `process`; the ffmpeg.exe is the fake one, which finishes its files and
 * exits 0 only on `q`.
 */

describe("stopping the recorder service mid-take", () => {
  it("stops the take with `q`, logs its stop, and only then lets the process exit; a second Ctrl-C cannot cut that short", async () => {
    const { windows, started, close, busy } = await recordOnce();
    const signals = new EventEmitter();
    let exited = false;
    const stopped = stopCleanlyOn({ close, busy }, signals, () => {}).then(
      (e) => {
        exited = true;
        return e;
      }
    );

    signals.emit("SIGINT");
    // Ctrl-C twice: still handled, so Node's default (kill) never runs.
    expect(signals.listenerCount("SIGINT")).toBe(1);
    signals.emit("SIGINT");
    signals.emit("SIGTERM");
    expect(exited).toBe(false);

    expect(await stopped).toBe("SIGINT");
    // Every recorder was asked to close its files and did: none was killed.
    for (const feed of ["camera", "screen"] as const)
      expect(windows.recorder(feed).running).toBe(false);
    const log = readLog(
      path.join(path.dirname(started.files.mic), "events.jsonl")
    );
    expect(log.at(-1)).toMatchObject({
      type: "recording-stopped",
      reason: "requested",
      exitCodes: { screen: 0, camera: 0 },
    });
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  it("refuses the app server's idle stop while a take records, and honours it once the take is stopped (#2383)", async () => {
    const { windows, client, close, busy } = await recordOnce();
    const ipc = new EventEmitter();
    const lines: string[] = [];
    let exited = false;
    const stopped = stopCleanlyOn({ close, busy }, ipc, (line) =>
      lines.push(line)
    ).then((e) => {
      exited = true;
      return e;
    });

    ipc.emit("message", IDLE_STOP);
    await new Promise((r) => setTimeout(r, 50));
    expect(exited).toBe(false);
    expect(lines).toEqual([
      "idle-stop: refused, a take is recording or closing",
    ]);
    // Not one frame lost to it: the take is still recording.
    for (const feed of ["camera", "screen"] as const)
      expect(windows.recorder(feed).running).toBe(true);

    client.send({ type: "stop" });
    await vi.waitFor(() => expect(busy()).toBe(false));
    ipc.emit("message", IDLE_STOP);
    expect(await stopped).toBe("idle-stop");
  });
});
