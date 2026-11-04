import { Context, Effect, Layer } from "effect";
import { recorderRecordingSignal } from "./recorder-still-gate";
import { untilRecordingIs, type RecordingSignal } from "./still-gate";

/**
 * THE GPU GATE (#2631): a live Recording Session or Live Stream gets the GPU
 * before Local Whisper. On 2026-11-03 a stream dropped to 24-38 fps (encode
 * speed 0.10-0.63, two stream relaunches, ~120 camera frames lost at
 * capture) while Whisper transcribed a 56-minute Footage import and the
 * stream's Clips beside it, the GPU at 100%. Raw Footage and the stream win
 * over transcription latency.
 *
 * So each Whisper pass (one Clip, or one chunk of a Footage file) starts only
 * while nothing records. A Live Stream always records (ADR 0055), so one
 * signal covers both. A pass asked for during a Recording Session waits for
 * the Stop, then runs. A pass already on the GPU when Record is pressed
 * finishes: the worker cannot be told to stop mid-file without unloading
 * the model. A Footage transcription is a run of chunks, so it yields at
 * its next chunk (~15 s at most) and resumes after the Stop.
 *
 * The other GPU users wait at the same gate (#2644): every NVENC encode run
 * (`runFfmpegWithProgress`'s encode-slot passes: a Video's export, a Batch
 * export or Publish, an Animatic, a Short's render, the Posting Queue's
 * just-in-time `render-vertical`), and each line Kokoro voices for a Clip
 * Mockup (`resolveClipMockupSpeeches`). Each yields at its next run or line.
 *
 * Unlike the Still Gate, nothing here fails: a Job has no browser connection
 * to hold, so it waits. A gated Job is still running, so it is never a
 * failure, nor a Posting Queue's posting failure; it carries on at the Stop.
 */
export const makeGpuGate =
  (signal: RecordingSignal) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      if (signal.recording()) {
        yield* Effect.logInfo(
          "GPU gate: a Recording Session is live; this GPU work waits for the Stop"
        );
        yield* untilRecordingIs(signal, false);
        yield* Effect.logInfo("GPU gate: the Recording Session stopped");
      }
      return yield* work;
    });

/** The gate GPU work (Whisper, NVENC, Kokoro) goes through. Only the Sidecar's layer provides it. */
export class GpuGate extends Context.Tag("GpuGate")<
  GpuGate,
  {
    readonly run: <A, E, R>(
      work: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>;
  }
>() {}

/**
 * The Sidecar's GPU gate, on the recorder service at `url`
 * (`stillGateRecorderUrl`), read as `cvm`'s Still Gate reads it: the Sidecar
 * has no recorder client of its own. Its `/health` is polled for the
 * Sidecar's whole life, not only while a pass waits, so a Record pressed
 * between two passes is heard before the next one starts.
 */
export const recorderGpuGateLayer = (url: string) =>
  Layer.scoped(
    GpuGate,
    Effect.gen(function* () {
      const signal = yield* recorderRecordingSignal(url);
      yield* Effect.acquireRelease(
        Effect.sync(() => signal.onRecordingChange(() => {})),
        (stop) => Effect.sync(stop)
      );
      return { run: makeGpuGate(signal) };
    })
  );
