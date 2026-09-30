import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import type { TestDb } from "@/test-utils/pglite";
import {
  ClipMockupSpeechService,
  pcmToWav,
  SpeechSynthesisError,
} from "@/services/clip-mockup-speech-service";
import { buildWriteLayer, type RunResult } from "./cli-write-test-harness";

/**
 * The speech fake every `cvm clip-mockup` suite runs on.
 *
 * `clip-mockup add` and `update` synthesise every "say" line, so without this
 * the suites would start the Clip Mockup daemon and load Kokoro onto a GPU for
 * real. The whole
 * ClipMockupSpeechService is replaced by `Layer.succeed`, exactly as the
 * `cvm footage` suite replaces VideoProcessingService to keep real ffmpeg and
 * real Whisper out of the run. NO MODEL IS EVER LOADED IN A TEST.
 *
 * What makes the fake REACHABLE is the `Effect.serviceOption` branch in
 * services/resolve-clip-mockup-speech.ts — without it the command would always
 * send its lines to the daemon and this would be ignored.
 */

const FAKE_SAMPLE_RATE = 24000;

/** The fixed duration the fake reports for every line it is given. */
export const FAKE_DURATION_SECONDS = 1.5;

/**
 * A REAL, minimal WAV of silence, not an arbitrary blob: the command reads a
 * cached file's run time back out of its header, so the canned buffer has to
 * be one the header parser agrees with — and its header says exactly
 * FAKE_DURATION_SECONDS.
 */
export const FAKE_WAV = pcmToWav(
  Buffer.alloc(FAKE_SAMPLE_RATE * 2 * FAKE_DURATION_SECONDS),
  FAKE_SAMPLE_RATE
);

export interface SpeechFake {
  readonly layer: Layer.Layer<ClipMockupSpeechService>;
  /** Every line actually handed to the synthesiser, in order. Empty == cached. */
  readonly spoken: string[];
}

/** A fake that voices anything, instantly, as FAKE_DURATION_SECONDS of silence. */
export const fakeSpeech = (): SpeechFake => {
  const spoken: string[] = [];
  const layer = Layer.succeed(ClipMockupSpeechService, {
    synthesizeLine: (line: string) =>
      Effect.sync(() => {
        spoken.push(line);
        return { wav: FAKE_WAV, durationSeconds: FAKE_DURATION_SECONDS };
      }),
  } as unknown as ClipMockupSpeechService);
  return { layer, spoken };
};

/** The message the failing fake reports, so a test can assert it round-trips. */
export const SPEECH_FAILURE_MESSAGE =
  "Kokoro could not voice a 3-word chunk: the voice fell over";

/** A fake that always refuses — the failure path #1643 requires asserted. */
export const failingSpeech = (): SpeechFake => {
  const spoken: string[] = [];
  const layer = Layer.succeed(ClipMockupSpeechService, {
    synthesizeLine: (line: string) =>
      Effect.suspend(() => {
        spoken.push(line);
        return Effect.fail(
          new SpeechSynthesisError({
            cause: null,
            message: SPEECH_FAILURE_MESSAGE,
          })
        );
      }),
  } as unknown as ClipMockupSpeechService);
  return { layer, spoken };
};

/**
 * A run() with the write layer AND a speech fake merged in. The footage suite
 * inlines this for the same reason: `makeRun` provides one layer, and these
 * verbs need two.
 */
export const makeClipMockupRun =
  (db: TestDb, speech: SpeechFake) =>
  async (argv: ReadonlyArray<string>): Promise<RunResult> => {
    const out = makeTestCliOutput();
    const layer = Layer.merge(buildWriteLayer(db), speech.layer);
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };

/**
 * Write a `--clip-mockups-json` file and return its path — the one input of
 * `clip-mockup add` and `update`. Relative paths inside it resolve against
 * the file's own directory, so tests pass ABSOLUTE frame paths.
 */
export const clipMockupsJson = (entries: ReadonlyArray<unknown>): string => {
  const dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-batch-"));
  const file = nodePath.join(dir, "clip-mockups.json");
  nodeFs.writeFileSync(file, JSON.stringify(entries));
  return file;
};

/** argv for `clip-mockup add` of these entries to this Video. */
export const addArgv = (
  videoId: string,
  entries: ReadonlyArray<unknown>
): string[] => [
  "clip-mockup",
  "add",
  "--video",
  videoId,
  "--clip-mockups-json",
  clipMockupsJson(entries),
];

/** argv for `clip-mockup update` of these entries. */
export const updateArgv = (entries: ReadonlyArray<unknown>): string[] => [
  "clip-mockup",
  "update",
  "--clip-mockups-json",
  clipMockupsJson(entries),
];
