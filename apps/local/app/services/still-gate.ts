import { Context, Effect, Option } from "effect";

/**
 * THE STILL GATE (#2214, capture stalls). A still (a Clip's first or last
 * frame) is decoded by ffmpeg in WSL, reading the Footage over /mnt/d. Each
 * takes 1.5-3.2 s, and the editor asks for a page of them the moment a
 * Recording Session stops. They used to run straight into the next one:
 * Recording Session 24ad7e82 lost 278 camera frames while DirectShow's buffer
 * sat 63-77% full, right over a run of them.
 *
 * So a still's decode only runs while nothing records, one at a time, and a
 * Record that starts while one runs stops it (its ffmpeg is killed) and puts
 * it back to wait for the Stop. Linux `nice` cannot do this: it never reaches
 * the Windows scheduler the camera capture runs under.
 */

/** Whether the recorder is recording: the app server's recorder client. */
export type RecordingSignal = {
  recording: () => boolean;
  /** Hears each time recording starts (true) or stops (false); answers an unsubscribe. */
  onRecordingChange: (listener: (recording: boolean) => void) => () => void;
};

/** Waits until `signal` reads `want`; at once if it already does. */
const until = (signal: RecordingSignal, want: boolean) =>
  Effect.async<void>((resume) => {
    if (signal.recording() === want) return resume(Effect.void);
    const stop = signal.onRecordingChange((recording) => {
      if (recording !== want) return;
      stop();
      resume(Effect.void);
    });
    return Effect.sync(stop);
  });

/**
 * Runs each decode handed to it only while nothing records, one at a time;
 * a decode a Record interrupts is run again after the Stop.
 */
export const makeStillGate = (signal: RecordingSignal) => {
  const one = Effect.unsafeMakeSemaphore(1);
  return <A, E, R>(decode: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    one.withPermits(1)(
      Effect.gen(function* () {
        while (true) {
          yield* until(signal, false);
          const done = yield* Effect.raceFirst(
            decode.pipe(Effect.map(Option.some)),
            until(signal, true).pipe(Effect.as(Option.none<A>()))
          );
          if (Option.isSome(done)) return done.value;
        }
      })
    );
};

/**
 * The gate a still's decode goes through. Only the app server provides it
 * (`layer.server.ts`): a CLI or a test decodes at once.
 */
export class StillGate extends Context.Tag("StillGate")<
  StillGate,
  {
    readonly run: <A, E, R>(
      decode: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>;
  }
>() {}
