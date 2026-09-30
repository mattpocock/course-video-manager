import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import nodePath from "node:path";
import type { ClipMockupSpeech } from "@/services/db-clip-mockup-operations.server";
import { clipMockupFileExists, readClipMockupFile } from "./clip-mockup-files";
import {
  ClipMockupSpeechService,
  SpeechSynthesisError,
  speechFilename,
  wavDurationSeconds,
} from "./clip-mockup-speech-service";
import { speakLinesInDaemon } from "./clip-mockup-daemon/client";

/**
 * The one place a Clip Mockup's line gets voiced — the content-addressed
 * cache and the test seam.
 *
 * IT WRITES NOTHING. New speech comes back as bytes, in `files`, and the
 * caller writes them with its frames once EVERYTHING in the batch has
 * succeeded — so a frame that fails to capture while the lines are being
 * voiced leaves no WAV behind either.
 *
 * Its callers are `cvm clip-mockup add` and `update`, a whole batch at a time.
 * It lives under `app/services/` — the code the CLI and the web app may both
 * reach — rather than inside a CLI verb module, so a web surface that must
 * voice a line can call the same path instead of re-voicing the line
 * differently (#1672).
 */

/** A line to voice, and the Video (by `lineageId`) whose directory it goes in. */
export interface LineToSpeak {
  readonly lineageId: string;
  readonly line: string;
}

const keyOf = (item: LineToSpeak) => `${item.lineageId}\n${item.line}`;

/**
 * A line's speech, if it is already on disk.
 *
 * The WAV is named by a hash of the line, the voice and the model, so the
 * SAME WORDS ARE ONLY EVER SPOKEN ONCE per Video: a second Clip Mockup with
 * the same line finds the file already there and reads its run time straight
 * out of the WAV header instead of paying for it again. A file that cannot be
 * read as a WAV counts as a miss and is re-synthesised over.
 */
const cachedSpeech = (item: LineToSpeak) =>
  Effect.gen(function* () {
    const audioPath = speechFilename(item.line);
    if (!(yield* clipMockupFileExists(item.lineageId, audioPath))) {
      return Option.none<ClipMockupSpeech>();
    }
    const bytes = yield* readClipMockupFile(item.lineageId, audioPath).pipe(
      Effect.orElseSucceed(() => undefined)
    );
    const durationSeconds =
      bytes === undefined ? undefined : wavDurationSeconds(bytes);
    return durationSeconds === undefined
      ? Option.none<ClipMockupSpeech>()
      : Option.some({ audioPath, durationSeconds });
  });

/** A WAV voiced for this batch, and where in the store it belongs. */
export interface SpokenFile {
  readonly lineageId: string;
  readonly audioPath: string;
  readonly wav: Uint8Array;
}

/**
 * Voice the misses in the Clip Mockup daemon, all in one request. It writes
 * into a scratch directory, and the bytes are read back out of it.
 */
const speakInDaemon = (misses: ReadonlyArray<LineToSpeak>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const asSpeechError = (message: string) => (cause: unknown) =>
      new SpeechSynthesisError({ cause, message });
    const scratch = yield* fs
      .makeTempDirectoryScoped({ prefix: "cvm-speech-" })
      .pipe(
        Effect.mapError(
          asSpeechError("could not make a temp directory to voice lines in")
        )
      );
    const items = misses.map((miss, i) => ({
      line: miss.line,
      outputPath: nodePath.join(scratch, `${i}.wav`),
    }));
    const durations = yield* speakLinesInDaemon(items);

    const spoken: { wav: Uint8Array; durationSeconds: number }[] = [];
    for (const [i, item] of items.entries()) {
      const wav = yield* fs
        .readFile(item.outputPath)
        .pipe(
          Effect.mapError(
            asSpeechError("the daemon reported a line voiced but wrote no WAV")
          )
        );
      spoken.push({ wav, durationSeconds: durations[i]! });
    }
    return spoken;
  }).pipe(Effect.scoped);

/**
 * The speech of every line, and how long each one runs — one answer per item,
 * in order — plus the WAVs that are new and still have to be written.
 *
 * Only the lines not already on disk are voiced, each of them once however
 * many times it appears. They go to the Clip Mockup daemon together, so a
 * batch of sixty lines pays for one model load at most, and for none when the
 * daemon is already warm.
 *
 * The `Effect.serviceOption` branch is the test seam: a suite provides a
 * `Layer.succeed` ClipMockupSpeechService, and no daemon is started and no
 * model is loaded.
 */
export const resolveClipMockupSpeeches = (items: ReadonlyArray<LineToSpeak>) =>
  Effect.gen(function* () {
    const resolved = new Map<string, ClipMockupSpeech>();
    const misses: LineToSpeak[] = [];
    const files: SpokenFile[] = [];
    for (const item of new Map(items.map((i) => [keyOf(i), i])).values()) {
      const cached = yield* cachedSpeech(item);
      if (Option.isSome(cached)) resolved.set(keyOf(item), cached.value);
      else misses.push(item);
    }

    if (misses.length > 0) {
      const provided = yield* Effect.serviceOption(ClipMockupSpeechService);
      const spoken = yield* Option.match(provided, {
        onSome: (svc) =>
          Effect.forEach(misses, (miss) => svc.synthesizeLine(miss.line)),
        onNone: () => speakInDaemon(misses),
      });
      for (const [i, miss] of misses.entries()) {
        const audioPath = speechFilename(miss.line);
        resolved.set(keyOf(miss), {
          audioPath,
          durationSeconds: spoken[i]!.durationSeconds,
        });
        files.push({
          lineageId: miss.lineageId,
          audioPath,
          wav: spoken[i]!.wav,
        });
      }
    }

    return {
      speeches: items.map((item) => resolved.get(keyOf(item))!),
      files,
    };
  });
