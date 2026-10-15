import { Deferred, Effect, Fiber, Ref, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";
import { makeStillGate, type RecordingSignal } from "./still-gate";

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
    for (const l of [...listeners]) l(now);
  };
  return { signal, set, listening: () => listeners.size };
};

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));

/** Lets every fiber that can move, move. */
const settle = Effect.yieldNow().pipe(Effect.repeatN(20));

describe("the still gate", () => {
  it("decodes at once while nothing records", async () => {
    const recorder = fakeRecorder(false);
    const gate = makeStillGate(recorder.signal);
    expect(await run(gate(Effect.succeed("still.png")))).toBe("still.png");
    expect(recorder.listening()).toBe(0);
  });

  it("waits while a Recording Session records, and decodes after the Stop", async () => {
    const recorder = fakeRecorder(true);
    const gate = makeStillGate(recorder.signal);
    await run(
      Effect.gen(function* () {
        const started = yield* Ref.make(0);
        const fiber = yield* Effect.fork(
          gate(Ref.update(started, (n) => n + 1).pipe(Effect.as("still.png")))
        );
        yield* settle;
        expect(yield* Ref.get(started)).toBe(0);
        recorder.set(false);
        expect(yield* Fiber.join(fiber)).toBe("still.png");
        expect(yield* Ref.get(started)).toBe(1);
      })
    );
    expect(recorder.listening()).toBe(0);
  });

  it("stops a decode when Record is pressed, and runs it again after the Stop", async () => {
    const recorder = fakeRecorder(false);
    const gate = makeStillGate(recorder.signal);
    await run(
      Effect.gen(function* () {
        const runs = yield* Ref.make(0);
        const interrupted = yield* Ref.make(0);
        // A decode that takes 2 s, like a still read over /mnt/d.
        const decode = Ref.update(runs, (n) => n + 1).pipe(
          Effect.zipRight(Effect.sleep("2 seconds")),
          Effect.onInterrupt(() => Ref.update(interrupted, (n) => n + 1)),
          Effect.as("still.png")
        );
        const fiber = yield* Effect.fork(gate(decode));
        yield* settle;
        expect(yield* Ref.get(runs)).toBe(1);

        recorder.set(true);
        yield* settle;
        expect(yield* Ref.get(interrupted)).toBe(1);
        yield* TestClock.adjust("10 seconds");
        expect(fiber.unsafePoll()).toBeNull();

        recorder.set(false);
        yield* settle;
        expect(yield* Ref.get(runs)).toBe(2);
        yield* TestClock.adjust("2 seconds");
        expect(yield* Fiber.join(fiber)).toBe("still.png");
      })
    );
  });

  it("decodes one still at a time", async () => {
    const recorder = fakeRecorder(false);
    const gate = makeStillGate(recorder.signal);
    await run(
      Effect.gen(function* () {
        const running = yield* Ref.make(0);
        const most = yield* Ref.make(0);
        const release = yield* Deferred.make<void>();
        const decode = Effect.gen(function* () {
          const now = yield* Ref.updateAndGet(running, (n) => n + 1);
          yield* Ref.update(most, (m) => Math.max(m, now));
          yield* Deferred.await(release);
          yield* Ref.update(running, (n) => n - 1);
        });
        const fiber = yield* Effect.fork(
          Effect.all([gate(decode), gate(decode), gate(decode)], {
            concurrency: "unbounded",
          })
        );
        yield* settle;
        expect(yield* Ref.get(running)).toBe(1);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
        expect(yield* Ref.get(most)).toBe(1);
      })
    );
  });

  it("passes a decode's failure on", async () => {
    const gate = makeStillGate(fakeRecorder(false).signal);
    await expect(run(gate(Effect.fail("no GPU")))).rejects.toThrow("no GPU");
  });
});
