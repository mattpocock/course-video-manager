import { Context, Data, Effect, Layer } from "effect";

/**
 * What one Whisper pass over an audio file gives back, in seconds from the
 * file's start. A word's text has no leading space; a segment's keeps
 * Whisper's.
 */
export interface AudioTranscript {
  readonly segments: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
    readonly text: string;
  }>;
  readonly words: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
    readonly text: string;
  }>;
}

export class LocalWhisperError extends Data.TaggedError("LocalWhisperError")<{
  cause: unknown;
  message: string;
}> {}

/**
 * **Local Whisper**: faster-whisper on this machine's GPU, in a worker the
 * Sidecar keeps alive so the model stays loaded
 * (`sidecar/local-whisper-engine.ts`). It is the only Whisper engine: there
 * is no hosted fallback, so when the GPU or its Python env is unavailable a
 * transcription fails with an error that names the fix.
 *
 * Only the Sidecar's layer builds the live engine. Tests that build
 * `WhisperTranscriptionService.Default` without transcribing take
 * {@link LocalWhisperUnavailable}.
 */
export class LocalWhisperEngine extends Context.Tag("LocalWhisperEngine")<
  LocalWhisperEngine,
  {
    readonly transcribe: (
      audioPath: string
    ) => Effect.Effect<AudioTranscript, LocalWhisperError>;
  }
>() {}

/** An engine that refuses every file: for tests that never transcribe. */
export const LocalWhisperUnavailable = Layer.succeed(LocalWhisperEngine, {
  transcribe: () =>
    Effect.fail(
      new LocalWhisperError({
        cause: null,
        message:
          "Local Whisper runs only in the Sidecar (sidecar/local-whisper-engine.ts)",
      })
    ),
});
