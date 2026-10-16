import { Context, Data, Effect, Option } from "effect";

/**
 * THE STILL GATE (#2214, capture stalls). A still (a Clip's first or last
 * frame) is decoded by ffmpeg in WSL, reading the Footage over /mnt/d. Each
 * takes 1.5-3.2 s, and the editor asks for a page of them the moment a
 * Recording Session stops. They used to run straight into the next one:
 * Recording Session 24ad7e82 lost 278 camera frames while DirectShow's buffer
 * sat 63-77% full, right over a run of them.
 *
 * So a still's decode only runs while nothing records, one at a time, and a
 * Record that starts while one runs stops it (its ffmpeg is killed). Linux
 * `nice` cannot do this: it never reaches the Windows scheduler the camera
 * capture runs under.
 *
 * A held still FAILS AT ONCE (`StillHeldError`, a 503); it never waits for
 * the Stop. A still is an `<img>` request, and one parked until Stop held one
 * of the browser's six HTTP/1.1 connections to the app for the whole
 * Recording Session: six of them and no Clip could play, and the editor
 * could not even be reloaded. The editor asks again after the Stop.
 */

/** A still asked for while the recorder records: ask again after the Stop. */
export class StillHeldError extends Data.TaggedError("StillHeldError")<{
  readonly message: string;
}> {}

const held = () =>
  new StillHeldError({
    message: "No still while recording: ask again after the Stop",
  });

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
 * Runs each decode handed to it only while nothing records, one at a time.
 * While recording, or once a Record interrupts it, it fails with
 * `StillHeldError` instead of waiting.
 */
export const makeStillGate = (signal: RecordingSignal) => {
  const one = Effect.unsafeMakeSemaphore(1);
  return <A, E, R>(
    decode: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | StillHeldError, R> =>
    Effect.gen(function* () {
      if (signal.recording()) return yield* held();
      return yield* one.withPermits(1)(
        Effect.gen(function* () {
          // Record may have started while this waited its turn.
          if (signal.recording()) return yield* held();
          const done = yield* Effect.raceFirst(
            decode.pipe(Effect.map(Option.some)),
            until(signal, true).pipe(Effect.as(Option.none<A>()))
          );
          if (Option.isNone(done)) return yield* held();
          return done.value;
        })
      );
    });
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
    ) => Effect.Effect<A, E | StillHeldError, R>;
  }
>() {}
