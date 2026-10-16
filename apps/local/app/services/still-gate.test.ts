import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Ref,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeLoader } from "./route-action.server";
import {
  makeStillGate,
  StillHeldError,
  type RecordingSignal,
} from "./still-gate";

// The app's layer refuses to load without STORAGE_ROOTS (its startup check);
// these tests read no file, so any root will do.
vi.hoisted(() => {
  process.env.STORAGE_ROOTS ??= "/test-storage-root";
});

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

  it("answers a still asked for while a Recording Session records at once, held, without decoding", async () => {
    const recorder = fakeRecorder(true);
    const gate = makeStillGate(recorder.signal);
    const exit = await run(
      Effect.gen(function* () {
        const started = yield* Ref.make(0);
        const exit = yield* Effect.exit(
          gate(Ref.update(started, (n) => n + 1).pipe(Effect.as("still.png")))
        );
        expect(yield* Ref.get(started)).toBe(0);
        return exit;
      })
    );
    expect(exit).toEqual(Exit.fail(expect.any(StillHeldError)));
    expect(recorder.listening()).toBe(0);
  });

  it("stops a decode when Record is pressed and answers it held, and decodes again after the Stop", async () => {
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
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);

        // The editor asks again after the Stop.
        recorder.set(false);
        const again = yield* Effect.fork(gate(decode));
        yield* TestClock.adjust("2 seconds");
        expect(yield* Fiber.join(again)).toBe("still.png");
        expect(yield* Ref.get(runs)).toBe(2);
      })
    );
  });

  it("answers held a still that was waiting its turn when Record was pressed", async () => {
    const recorder = fakeRecorder(false);
    const gate = makeStillGate(recorder.signal);
    await run(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>();
        const first = yield* Effect.fork(gate(Deferred.await(release)));
        const waiting = yield* Effect.fork(gate(Effect.succeed("still.png")));
        yield* settle;
        recorder.set(true);
        yield* settle;
        expect(Exit.isFailure(yield* Fiber.await(first))).toBe(true);
        const exit = yield* Fiber.await(waiting);
        expect(exit).toEqual(Exit.fail(expect.any(StillHeldError)));
      })
    );
  });

  it("a still route answers 503 at once while recording, never parking the browser's connection", async () => {
    const gate = makeStillGate(fakeRecorder(true).signal);
    // The first-frame route's error map.
    const loader = makeLoader(
      {
        errors: { StillHeldError: 503 },
        effect: () => gate(Effect.never.pipe(Effect.as("still.png"))),
      },
      ManagedRuntime.make(Layer.empty)
    );
    const thrown = await loader({
      request: new Request("http://test.local/clips/c/first-frame"),
      params: {},
    }).then(
      () => undefined,
      (error: unknown) => error as { init: { status: number } }
    );
    expect(thrown?.init.status).toBe(503);
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
