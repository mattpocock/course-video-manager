import { describe, it, expect } from "vitest";
import {
  Deferred,
  Duration,
  Effect,
  Fiber,
  Logger,
  TestClock,
  TestContext,
} from "effect";
import {
  makeUploadMeter,
  throughputFields,
  UPLOAD_REPORT_INTERVAL,
} from "./dropbox-upload-throughput";

const MB = 1024 * 1024;

/** Run under the TestClock, capturing every log line's annotations. */
const runCapturing = <A, E>(effect: Effect.Effect<A, E>) => {
  const lines: Array<{ message: unknown; fields: Record<string, unknown> }> =
    [];
  const logger = Logger.make(({ message, annotations }) => {
    lines.push({
      message: Array.isArray(message) ? message[0] : message,
      fields: Object.fromEntries(annotations),
    });
  });
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
      Effect.provide(TestContext.TestContext)
    )
  ).then((result) => ({ result, lines }));
};

describe("upload throughput", () => {
  it("reports bytes, seconds and MB/s", () => {
    expect(throughputFields(64 * MB, 4_000)).toEqual({
      bytes: 64 * MB,
      seconds: 4,
      mbPerSecond: 16,
    });
    expect(throughputFields(0, 0)).toEqual({
      bytes: 0,
      seconds: 0,
      mbPerSecond: 0,
    });
  });

  // A stall must be visible: the total keeps being reported while it stops
  // climbing, rather than the log going quiet.
  it("logs the pool's running total every 30 s until the pool settles", async () => {
    const { lines } = await runCapturing(
      Effect.gen(function* () {
        const meter = yield* makeUploadMeter;
        const done = yield* Deferred.make<void>();
        const pool = yield* Effect.fork(
          meter.reportWhile(Deferred.await(done))
        );

        meter.addSent(30 * MB);
        yield* TestClock.adjust(UPLOAD_REPORT_INTERVAL);
        // Stalled: nothing more is sent in the next interval.
        yield* TestClock.adjust(UPLOAD_REPORT_INTERVAL);
        yield* Deferred.succeed(done, undefined);
        yield* Fiber.join(pool);
        // Nothing reports once the pool has settled.
        yield* TestClock.adjust(Duration.times(UPLOAD_REPORT_INTERVAL, 3));
      })
    );

    expect(
      lines.filter((line) => line.message === "publish: upload pool running")
    ).toEqual([
      expect.objectContaining({
        fields: { bytes: 30 * MB, seconds: 30, mbPerSecond: 1 },
      }),
      expect.objectContaining({
        fields: { bytes: 30 * MB, seconds: 60, mbPerSecond: 0.5 },
      }),
    ]);
  });

  it("stops reporting when the pool fails", async () => {
    const { result, lines } = await runCapturing(
      Effect.gen(function* () {
        const meter = yield* makeUploadMeter;
        const outcome = yield* Effect.either(
          meter.reportWhile(Effect.fail("rejected" as const))
        );
        yield* TestClock.adjust(Duration.times(UPLOAD_REPORT_INTERVAL, 3));
        return outcome;
      })
    );

    expect(result._tag).toBe("Left");
    expect(lines).toEqual([]);
  });
});
