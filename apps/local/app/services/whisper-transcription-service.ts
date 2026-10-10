import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Schema } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import {
  transcribeFootage,
  type TranscribeFootageOptions,
} from "./footage-transcription";
import { SidecarContext } from "./sidecar-context";
import { LocalWhisperEngine } from "./local-whisper-engine";
import { removeBestEffort } from "@/services/remove-best-effort";

/**
 * How `extractAudio` encodes: a Clip's range at 384kbps as recorded, or a whole
 * Footage file (or a chunk of one) mono at 64kbps.
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
 * **Whisper transcription**: ffmpeg extracts the audio and Local Whisper
 * transcribes it on this machine's GPU, one file at a time
 * (`local-whisper-engine.ts`). There is no other engine and no fallback.
 *
 * Sidecar only (docs/plans/background-jobs-sidecar.md, batches 7 and 9): a
 * Clip transcription (the `transcribe-clips` Job), the vertical Short's
 * subtitles (the `render-vertical` Job) and a Footage transcription (the
 * `transcribe-footage` Job, which `cvm footage transcribe` enqueues) ask for
 * `SidecarContext`, only the Sidecar's layer (`sidecar/sidecar-layer.ts`)
 * builds this service, and no module a route can reach may import it
 * (`.dependency-cruiser.spawn.cjs`). One Sidecar, one Local Whisper worker,
 * shared by all three.
 */
export class WhisperTranscriptionService extends Effect.Service<WhisperTranscriptionService>()(
  "WhisperTranscriptionService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const ffmpegCommands = yield* FFmpegCommandsService;
      const localWhisper = yield* LocalWhisperEngine;

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

      /** One audio file through Local Whisper. Every caller below goes through here. */
      const transcribeAudioFile = (audioPath: string) =>
        localWhisper.transcribe(audioPath).pipe(
          Effect.mapError(
            (error) =>
              new CouldNotTranscribeError({
                cause: error,
                message: error.message,
              })
          )
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
       * pass. Extracts the full audio track and transcribes it once.
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
