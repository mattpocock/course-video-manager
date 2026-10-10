import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Data, Effect, Option, Schema } from "effect";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "os";
import OpenAI from "openai";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import {
  transcribeFootage,
  type TranscribeFootageOptions,
} from "./footage-transcription";
import { SidecarContext } from "./sidecar-context";
import {
  chooseTranscriber,
  LocalWhisperEngine,
  type AudioTranscript,
} from "./local-whisper-engine";
import { removeBestEffort } from "@/services/remove-best-effort";

const TRANSCRIPTION_PERMITS = 20;

/**
 * How `extractAudio` encodes: a Clip's range at 384kbps as recorded, or a whole
 * Footage file (or a chunk of one) mono at 64kbps, small enough that most
 * files fit Whisper's 25MB upload in one pass.
 */
const CLIP_AUDIO = ["-b:a", "384k"] as const;
const FOOTAGE_AUDIO = ["-ac", "1", "-b:a", "64k"] as const;

const transcribeClipsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    words: Schema.Array(
      Schema.Struct({
        start: Schema.Number,
        end: Schema.Number,
        text: Schema.String,
      })
    ),
    segments: Schema.Array(
      Schema.Struct({
        start: Schema.Number,
        end: Schema.Number,
        text: Schema.String,
      })
    ),
  })
);

/**
 * Where `extractAudio` writes one call's mp3: named for what it holds, plus a
 * nonce, so two calls for the same range at once (two Jobs for the same Clip)
 * never overwrite or delete each other's file.
 */
export const whisperAudioPath = (
  outputDir: string,
  inputVideo: string,
  range: { startTime: number; duration: number } | undefined
): string => {
  const outputHash = crypto
    .createHash("sha256")
    .update(
      range
        ? `${inputVideo}-${range.startTime}-${range.duration}`
        : `${inputVideo}-full-audio`
    )
    .digest("hex")
    .slice(0, 12);
  return path.join(
    outputDir,
    `${outputHash}-${crypto.randomUUID().slice(0, 8)}.mp3`
  );
};

class CouldNotTranscribeError extends Data.TaggedError(
  "CouldNotTranscribeError"
)<{
  cause: unknown;
  message: string;
}> {}

class CouldNotExtractAudioError extends Data.TaggedError(
  "CouldNotExtractAudioError"
)<{
  cause: unknown;
  message: string;
}> {}

/**
 * **Whisper transcription**: ffmpeg extracts the audio, OpenAI's Whisper
 * transcribes it, at most 20 calls at once (the permits are this service's,
 * shared by every caller in the process) — or, with `CVM_WHISPER_ENGINE=local`,
 * Local Whisper on the GPU does, one file at a time, with OpenAI as the
 * fallback (`local-whisper-engine.ts`).
 *
 * Sidecar only (docs/plans/background-jobs-sidecar.md, batches 7 and 9): a
 * Clip transcription (the `transcribe-clips` Job), the vertical Short's
 * subtitles (the `render-vertical` Job) and a Footage transcription (the
 * `transcribe-footage` Job, which `cvm footage transcribe` enqueues) ask for
 * `SidecarContext`, only the Sidecar's layer (`sidecar/sidecar-layer.ts`)
 * builds this service, and no module a route can reach may import it
 * (`.dependency-cruiser.spawn.cjs`). One Sidecar, one service, so all three
 * share the same Whisper permits.
 */
export class WhisperTranscriptionService extends Effect.Service<WhisperTranscriptionService>()(
  "WhisperTranscriptionService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const ffmpegCommands = yield* FFmpegCommandsService;
      const transcriptionSemaphore = yield* Effect.makeSemaphore(
        TRANSCRIPTION_PERMITS
      );

      // With Local Whisper on, OpenAI is only the fallback, so its key is
      // optional; with it off, OpenAI is the engine and the key is required.
      const localWhisper = yield* LocalWhisperEngine;
      const openaiApiKey = localWhisper.enabled
        ? yield* Config.option(Config.string("OPENAI_API_KEY"))
        : Option.some(yield* Config.string("OPENAI_API_KEY"));
      const openai = Option.map(
        openaiApiKey,
        (apiKey) => new OpenAI({ apiKey })
      );

      /** ffmpeg writes `inputVideo`'s audio (or a range of it) as an mp3. */
      const extractAudio = Effect.fn("extractAudio")(function* (
        inputVideo: string,
        range: { startTime: number; duration: number } | undefined,
        encoding: ReadonlyArray<string> = CLIP_AUDIO
      ) {
        const outputDir = path.join(tmpdir(), "whisper-audio");
        yield* effectFs.makeDirectory(outputDir, { recursive: true });

        const outputFile = whisperAudioPath(outputDir, inputVideo, range);

        const rangeArgs = range
          ? ["-ss", range.startTime.toString(), "-t", range.duration.toString()]
          : [];

        const code = yield* Command.exitCode(
          Command.make(
            "ffmpeg",
            "-y",
            "-hide_banner",
            ...rangeArgs,
            "-i",
            inputVideo,
            "-vn",
            "-c:a",
            "libmp3lame",
            ...encoding,
            outputFile
          )
        ).pipe(
          Effect.mapError(
            (e) =>
              new CouldNotExtractAudioError({
                cause: e,
                message: `Failed to extract audio: ${e.message}`,
              })
          )
        );
        if (code !== 0) {
          return yield* new CouldNotExtractAudioError({
            cause: null,
            message: `Failed to extract audio, exit code: ${code}`,
          });
        }

        return outputFile;
      });

      /**
       * Transcribe a single audio file using OpenAI Whisper API.
       */
      const transcribeWithOpenAI = Effect.fn("transcribeWithOpenAI")(function* (
        client: OpenAI,
        audioPath: string
      ) {
        const response = yield* transcriptionSemaphore.withPermits(1)(
          Effect.tryPromise({
            try: async () => {
              const stream = fs.createReadStream(audioPath);
              return client.audio.transcriptions.create({
                file: stream,
                model: "whisper-1",
                response_format: "verbose_json",
                timestamp_granularities: ["segment", "word"],
              });
            },
            catch: (e) =>
              new CouldNotTranscribeError({
                cause: e,
                message: `Whisper API call failed: ${e}`,
              }),
          })
        );

        return {
          segments: (response.segments ?? []).map((segment) => ({
            start: segment.start,
            end: segment.end,
            text: segment.text,
          })),
          words: (response.words ?? []).map((word) => ({
            start: word.start,
            end: word.end,
            text: word.word,
          })),
        } satisfies AudioTranscript;
      });

      /**
       * One audio file through Whisper: Local Whisper when
       * `CVM_WHISPER_ENGINE=local` (falling back to OpenAI per file), else
       * OpenAI. Every caller below goes through here.
       */
      const transcribeAudioFile = chooseTranscriber(
        localWhisper,
        Option.match(openai, {
          onNone: () => null,
          onSome: (client) => (audioPath: string) =>
            transcribeWithOpenAI(client, audioPath),
        }),
        (cause) =>
          new CouldNotTranscribeError({
            cause,
            message: `No Whisper engine could transcribe: ${cause}`,
          })
      );

      /** Each Clip's range of its recording, transcribed on its own. */
      const transcribeClips = Effect.fn("transcribeClips")(function* (
        clips: {
          id: string;
          inputVideo: string;
          startTime: number;
          duration: number;
        }[]
      ) {
        // A Clip transcription is a Job: only the Sidecar runs it.
        yield* SidecarContext;
        const results = yield* Effect.forEach(
          clips,
          (clip) =>
            Effect.gen(function* () {
              const audioPath = yield* extractAudio(clip.inputVideo, {
                startTime: clip.startTime,
                duration: clip.duration,
              });
              const transcription = yield* transcribeAudioFile(audioPath);
              yield* removeBestEffort(effectFs, audioPath);

              return {
                id: clip.id,
                words: transcription.words,
                segments: transcription.segments,
              };
            }),
          { concurrency: "unbounded" }
        );

        return yield* Schema.decodeUnknown(transcribeClipsSchema)(results);
      });

      /**
       * Transcribe an entire, already-concatenated video in a single Whisper
       * pass. Extracts the full audio track (audio-only, so it stays well under
       * Whisper's 25MB upload limit even though the source video does not) and
       * transcribes it once.
       *
       * Unlike {@link transcribeClips}, the returned segment timestamps are on
       * the video's own final timeline, so downstream callers need no per-clip
       * offset — matching the original Total TypeScript renderer, which
       * transcribed a single concatenated audio file.
       */
      const transcribeVideoFile = Effect.fn("transcribeVideoFile")(function* (
        inputVideo: string
      ) {
        // The vertical Short's subtitles: part of the `render-vertical` Job.
        yield* SidecarContext;
        const audioPath = yield* extractAudio(inputVideo, undefined);
        const transcription = yield* transcribeAudioFile(audioPath);
        yield* removeBestEffort(effectFs, audioPath);
        return transcription;
      });

      /**
       * Transcribe a whole raw FOOTAGE file (see GLOSSARY.md "Footage"): a file on
       * disk that is not — and never becomes — a database row. The
       * silence-chunking orchestration lives in {@link transcribeFootage}; it
       * reuses THIS service's {@link extractAudio} and {@link transcribeAudioFile}
       * per chunk, so faking WhisperTranscriptionService still fakes all of
       * footage transcription. Run by the `transcribe-footage` Job only. No
       * diarization, ever.
       */
      const transcribeFootageFile = (
        inputVideo: string,
        options?: TranscribeFootageOptions
      ) =>
        SidecarContext.pipe(
          Effect.zipRight(
            transcribeFootage(
              {
                ffmpegCommands,
                extractAudio: (video, range) =>
                  extractAudio(video, range, FOOTAGE_AUDIO),
                transcribeAudioFile,
              },
              inputVideo,
              options
            )
          )
        );

      return {
        transcribeClips,
        transcribeVideoFile,
        transcribeFootageFile,
      };
    }),
    dependencies: [NodeContext.layer, FFmpegCommandsService.Default],
  }
) {}
