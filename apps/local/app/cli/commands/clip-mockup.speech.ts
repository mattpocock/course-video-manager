import { Effect, Option } from "effect";
import {
  clipMockupFileExists,
  readClipMockupFile,
  writeClipMockupFile,
} from "@/services/clip-mockup-files";
import {
  ClipMockupSpeechService,
  speechFilename,
  wavDurationSeconds,
} from "@/services/clip-mockup-speech-service";
import { loadRepoEnv } from "@/cli/env";

/**
 * The speech half of `cvm clip-mockup`, split out of clip-mockup.ts so the
 * verb module stays under the repo's per-file token budget — the same reason
 * clip-mockup.help.ts is its own file.
 *
 * Everything about WHEN a line gets voiced lives here: the content-addressed
 * cache, the test seam, and the rule that nothing reaches the disk until the
 * words have actually been spoken.
 */

/**
 * The heavy service `clip-mockup add` and `update --say` reach for, built
 * LOCALLY here rather than merged into the shared cliRuntime — exactly like
 * `footage transcribe`: no read verb should have to satisfy GEMINI_API_KEY. It
 * is only reached on the branch below where the service was not already
 * provided, which is what lets a test inject a fake and never call Gemini.
 */
const speechLayer = ClipMockupSpeechService.Default;

/**
 * Make sure a line's speech is on disk, and say how long it runs.
 *
 * The WAV is named by a hash of the line, the voice and the model, so the
 * SAME WORDS ARE ONLY EVER SPOKEN ONCE per Video: a second Clip Mockup with
 * the same line finds the file already there and reads its run time straight
 * out of the WAV header instead of paying for it again. A file that cannot be
 * read as a WAV counts as a miss and is re-synthesised over.
 *
 * Nothing is written before the line has actually been voiced, so a failure
 * out of the speech service leaves the Clip Mockup directory exactly as it
 * found it.
 */
export const resolveClipMockupSpeech = (params: {
  readonly lineageId: string;
  readonly line: string;
}) =>
  Effect.gen(function* () {
    const audioPath = speechFilename(params.line);

    const cached = yield* clipMockupFileExists(params.lineageId, audioPath);
    if (cached) {
      const bytes = yield* readClipMockupFile(params.lineageId, audioPath).pipe(
        Effect.catchAll(() => Effect.succeed(undefined))
      );
      const durationSeconds =
        bytes === undefined ? undefined : wavDurationSeconds(bytes);
      if (durationSeconds !== undefined) {
        return { audioPath, durationSeconds };
      }
    }

    // Use an ambiently-provided ClipMockupSpeechService if there is one (a
    // test fake); otherwise build the real one here. loadRepoEnv runs OUTSIDE
    // the provided effect, because Effect.provide builds speechLayer before
    // the inner effect starts (commit 2205d419).
    const provided = yield* Effect.serviceOption(ClipMockupSpeechService);
    const spoken = yield* Option.match(provided, {
      onSome: (svc) => svc.synthesizeLine(params.line),
      onNone: () =>
        Effect.sync(() => loadRepoEnv()).pipe(
          Effect.zipRight(
            Effect.gen(function* () {
              const svc = yield* ClipMockupSpeechService;
              return yield* svc.synthesizeLine(params.line);
            }).pipe(Effect.provide(speechLayer))
          )
        ),
    });

    yield* writeClipMockupFile(params.lineageId, audioPath, spoken.wav);
    return { audioPath, durationSeconds: spoken.durationSeconds };
  });
