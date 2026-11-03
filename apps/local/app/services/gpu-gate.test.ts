import { Deferred, Effect, Fiber, Ref, TestContext } from "effect";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GpuGate, makeGpuGate, recorderGpuGateLayer } from "./gpu-gate";
import type { RecordingSignal } from "./still-gate";

/** A recorder the test starts and stops. */
const fakeRecorder = (recording = false) => {
  const listeners = new Set<(recording: boolean) => void>();
  const signal: RecordingSignal = {
    recording: () => recording,
    onRecordingChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const set = (now: boolean) => {
    recording = now;
    for (const l of listeners) l(now);
  };
  return { signal, set, listening: () => listeners.size };
};

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));

/** Lets every fiber that can move, move. */
const settle = Effect.yieldNow().pipe(Effect.repeatN(20));

describe("the GPU gate", () => {
  it("runs a Whisper pass at once while nothing records", async () => {
    const recorder = fakeRecorder(false);
    const gate = makeGpuGate(recorder.signal);
    expect(await run(gate(Effect.succeed("transcript")))).toBe("transcript");
    expect(recorder.listening()).toBe(0);
  });

  it("holds a pass asked for during a Recording Session (a Live Stream always records) until the Stop, then runs it", async () => {
    const recorder = fakeRecorder(true);
    const gate = makeGpuGate(recorder.signal);
    await run(
      Effect.gen(function* () {
        const passes = yield* Ref.make(0);
        const fiber = yield* Effect.fork(
          gate(Ref.updateAndGet(passes, (n) => n + 1))
        );
        yield* settle;
        expect(yield* Ref.get(passes)).toBe(0);

        recorder.set(false);
        expect(yield* Fiber.join(fiber)).toBe(1);
        expect(recorder.listening()).toBe(0);
      })
    );
  });

  it("lets the pass under way finish when Record is pressed, and holds the job's next chunk until the Stop", async () => {
    const recorder = fakeRecorder(false);
    const gate = makeGpuGate(recorder.signal);
    await run(
      Effect.gen(function* () {
        const heard = yield* Ref.make<string[]>([]);
        const firstChunkOnGpu = yield* Deferred.make<void>();
        const finishFirstChunk = yield* Deferred.make<void>();
        const chunk = (n: number) =>
          gate(
            Effect.gen(function* () {
              if (n === 1) {
                yield* Deferred.succeed(firstChunkOnGpu, undefined);
                yield* Deferred.await(finishFirstChunk);
              }
              yield* Ref.update(heard, (h) => [...h, `chunk ${n}`]);
            })
          );
        // A Footage transcription: its chunks one after another.
        const job = yield* Effect.fork(
          Effect.forEach([1, 2, 3], chunk, { discard: true })
        );
        yield* Deferred.await(firstChunkOnGpu);

        recorder.set(true);
        yield* Deferred.succeed(finishFirstChunk, undefined);
        yield* settle;
        expect(yield* Ref.get(heard)).toEqual(["chunk 1"]);

        recorder.set(false);
        yield* Fiber.join(job);
        expect(yield* Ref.get(heard)).toEqual([
          "chunk 1",
          "chunk 2",
          "chunk 3",
        ]);
      })
    );
  });

  it("passes a pass's failure on", async () => {
    const gate = makeGpuGate(fakeRecorder(false).signal);
    await expect(run(gate(Effect.fail("no GPU")))).rejects.toThrow("no GPU");
  });
});

// The Sidecar's gate reads the recorder service's `/health`, as `cvm`'s
// Still Gate does: a fake service on its own port, never Matt's.
describe("the Sidecar's GPU gate, on the recorder service's /health", () => {
  const recorder = { recording: false };
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          service: "recorder",
          pid: 1,
          state: recorder.recording ? { kind: "recording" } : { kind: "open" },
          takesClosing: false,
        })
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("hears a Record pressed long after the Sidecar started, and holds the next pass until the Stop", async () => {
    recorder.recording = false;
    const order: string[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* GpuGate;
        yield* gate.run(Effect.sync(() => order.push("before")));
        // Recording starts while no pass is asking.
        recorder.recording = true;
        yield* Effect.sleep("1500 millis");
        const held = yield* Effect.fork(
          gate.run(Effect.sync(() => order.push("held")))
        );
        yield* Effect.sleep("1500 millis");
        order.push("stop");
        recorder.recording = false;
        yield* Fiber.join(held);
      }).pipe(Effect.provide(recorderGpuGateLayer(url)), Effect.scoped)
    );
    expect(order).toEqual(["before", "stop", "held"]);
  }, 15_000);
});
