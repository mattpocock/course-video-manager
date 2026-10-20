import { Clock, Duration, Effect } from "effect";

/**
 * How fast the Dropbox leg of a Publish is going, in the job log.
 *
 * Two kinds of line: one per uploaded Video (written by `shipVideo`), and a
 * running total for the whole upload pool every `UPLOAD_REPORT_INTERVAL`, so a
 * stall shows as a total that stops climbing rather than as silence.
 *
 * Only bytes this machine actually SENT count. A Video copied inside Dropbox
 * or adopted from an earlier attempt moves nothing over the wire, so it would
 * only flatter the rate.
 */

const BYTES_PER_MB = 1024 * 1024;

/** How often a running upload pool says how far it has got. */
export const UPLOAD_REPORT_INTERVAL = Duration.seconds(30);

const roundTo = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** The fields every throughput line carries. MB is 1024 × 1024 bytes. */
export const throughputFields = (bytes: number, millis: number) => ({
  bytes,
  seconds: roundTo(millis / 1000, 1),
  mbPerSecond:
    millis > 0 ? roundTo(bytes / BYTES_PER_MB / (millis / 1000), 2) : 0,
});

/**
 * The running total of bytes sent across the upload pool, timed from the
 * moment the meter was made — i.e. the pool's own start, export waits
 * included, because that is the wait the author sits through.
 */
export const makeUploadMeter = Effect.map(
  Clock.currentTimeMillis,
  (startedAt) => {
    let sentBytes = 0;

    const snapshot = Effect.map(Clock.currentTimeMillis, (now) =>
      throughputFields(sentBytes, now - startedAt)
    );

    const report = Effect.flatMap(snapshot, (fields) =>
      Effect.logInfo("publish: upload pool running").pipe(
        Effect.annotateLogs(fields)
      )
    );

    return {
      /** Count `bytes` more as having left this machine. */
      addSent: (bytes: number) => {
        sentBytes += bytes;
      },
      snapshot,
      /**
       * Run `effect`, logging the running total every `interval` until it
       * settles. The reporter dies with it, success or failure.
       */
      reportWhile: <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        interval: Duration.DurationInput = UPLOAD_REPORT_INTERVAL
      ) =>
        Effect.raceFirst(
          effect,
          report.pipe(Effect.delay(interval), Effect.forever)
        ),
    };
  }
);

export type UploadMeter = Effect.Effect.Success<typeof makeUploadMeter>;
