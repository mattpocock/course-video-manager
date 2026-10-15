import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeWorker } from "./local-whisper-engine";

/**
 * A stand-in for worker.py that speaks the same protocol, so the engine's
 * process handling is tested without Python or a GPU. `FAKE_MODE` picks how
 * it behaves; each transcript names the fake's pid, so a test can tell
 * whether the worker was reused or started again.
 */
const FAKE_WORKER = `
const readline = require("node:readline");
const mode = process.argv[2];
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
if (mode === "fatal") {
  send({ fatal: "RuntimeError: CUDA failed with error no CUDA-capable device is detected" });
  process.exit(1);
}
console.log("a stray library print");
send({ ready: true, loadSeconds: 0 });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, audio } = JSON.parse(line);
  if (mode === "crash") process.exit(3);
  if (audio.endsWith("bad.mp3")) return send({ id, error: "InvalidDataError: bad.mp3" });
  send({
    id,
    segments: [
      { start: 0, end: 1, text: " pid " + process.pid },
      { start: 1, end: 2, text: " nice " + require("node:os").getPriority() },
    ],
    words: [{ start: 0, end: 1, text: String(process.pid) }],
  });
});
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-whisper-test-"));
const script = path.join(dir, "fake-worker.cjs");
fs.writeFileSync(script, FAKE_WORKER);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const worker = (mode: "ok" | "fatal" | "crash", idleMs = 60_000) =>
  makeWorker({
    command: process.execPath,
    args: [script, mode],
    idleMs,
    model: "large-v3-turbo",
  });

const pidOf = (t: { words: ReadonlyArray<{ text: string }> }) =>
  t.words[0]?.text;

describe("makeWorker", () => {
  it("starts once and answers every file from the same process", async () => {
    const w = worker("ok");
    const [a, b] = await Promise.all([
      w.transcribe("/a.mp3"),
      w.transcribe("/b.mp3"),
    ]);
    const c = await w.transcribe("/c.mp3");
    expect(pidOf(a)).toBeDefined();
    expect(new Set([pidOf(a), pidOf(b), pidOf(c)]).size).toBe(1);
    expect(a.segments[0]?.text).toBe(` pid ${pidOf(a)}`);
    w.stop();
  });

  it("runs the worker at the lowest CPU priority, below the capture (#2224)", async () => {
    const w = worker("ok");
    const t = await w.transcribe("/a.mp3");
    expect(t.segments[1]?.text).toBe(" nice 19");
    w.stop();
  });

  it("fails one bad file without losing the worker", async () => {
    const w = worker("ok");
    const before = await w.transcribe("/a.mp3");
    await expect(w.transcribe("/bad.mp3")).rejects.toThrow("InvalidDataError");
    const after = await w.transcribe("/b.mp3");
    expect(pidOf(after)).toBe(pidOf(before));
    w.stop();
  });

  it("loads the model when kept warm, holds it past the idle time, then stops once the hold lapses", async () => {
    const w = worker("ok", 50);
    w.keepWarm(400);
    expect(w.isRunning()).toBe(true);
    const during = await w.transcribe("/a.mp3");
    await new Promise((r) => setTimeout(r, 200));
    // Past the 50 ms idle time, still held: the same process answers.
    expect(w.isRunning()).toBe(true);
    expect(pidOf(await w.transcribe("/b.mp3"))).toBe(pidOf(during));
    await new Promise((r) => setTimeout(r, 500));
    expect(w.isRunning()).toBe(false);
    w.stop();
  });

  it("stops when idle and starts again on the next file", async () => {
    const w = worker("ok", 50);
    const first = await w.transcribe("/a.mp3");
    expect(w.isRunning()).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(w.isRunning()).toBe(false);
    const second = await w.transcribe("/b.mp3");
    expect(pidOf(second)).not.toBe(pidOf(first));
    w.stop();
  });

  it("names the GPU fix when the model will not load", async () => {
    const w = worker("fatal");
    const error = await w.transcribe("/a.mp3").catch((e: Error) => e);
    expect(String(error)).toContain(
      "Local Whisper could not load large-v3-turbo on the GPU"
    );
    expect(String(error)).toContain("no CUDA-capable device");
    expect(String(error)).toContain("nvidia-smi");
    expect(w.isRunning()).toBe(false);
  });

  it("fails the file in flight when the worker dies", async () => {
    const w = worker("crash");
    await expect(w.transcribe("/a.mp3")).rejects.toThrow(
      "The Local Whisper worker exited (code 3"
    );
    expect(w.isRunning()).toBe(false);
  });
});
