import { Context, Data, Effect, Layer } from "effect";

/**
 * What one Whisper pass over an audio file gives back, from either engine:
 * OpenAI's `verbose_json` shape, in seconds from the file's start. A word's
 * text has no leading space; a segment's keeps Whisper's.
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
 * Sidecar keeps alive so the model stays loaded (`sidecar/local-whisper-engine.ts`).
 * `enabled` is false unless `CVM_WHISPER_ENGINE=local`, and then
 * `WhisperTranscriptionService` uses OpenAI as before.
 *
 * Only the Sidecar's layer builds the live engine; tests and anything else
 * that builds `WhisperTranscriptionService.Default` take
 * {@link LocalWhisperDisabled}.
 */
export class LocalWhisperEngine extends Context.Tag("LocalWhisperEngine")<
  LocalWhisperEngine,
  {
    readonly enabled: boolean;
    readonly transcribe: (
      audioPath: string
    ) => Effect.Effect<AudioTranscript, LocalWhisperError>;
  }
>() {}

export const LocalWhisperDisabled = Layer.succeed(LocalWhisperEngine, {
  enabled: false,
  transcribe: () =>
    Effect.fail(
      new LocalWhisperError({
        cause: null,
        message: "Local Whisper is not enabled (CVM_WHISPER_ENGINE=local)",
      })
    ),
});

/**
 * The transcriber `WhisperTranscriptionService` uses: local when it is
 * enabled, falling back to OpenAI for a file the local engine could not do
 * (the worker would not start, the GPU ran out of memory) as long as an
 * OpenAI key is set. With the local engine off, OpenAI alone, as before.
 */
export const chooseTranscriber = <E>(
  local: LocalWhisperEngine["Type"],
  openai: ((audioPath: string) => Effect.Effect<AudioTranscript, E>) | null,
  noEngine: (cause: unknown) => E
) => {
  if (!local.enabled) {
    return (audioPath: string): Effect.Effect<AudioTranscript, E> =>
      openai ? openai(audioPath) : Effect.fail(noEngine(null));
  }
  return (audioPath: string): Effect.Effect<AudioTranscript, E> =>
    local
      .transcribe(audioPath)
      .pipe(
        Effect.catchTag("LocalWhisperError", (error) =>
          openai
            ? Effect.logWarning(
                "Local Whisper failed; falling back to OpenAI",
                { audioPath, error: error.message }
              ).pipe(Effect.zipRight(openai(audioPath)))
            : Effect.fail(noEngine(error))
        )
      );
};
