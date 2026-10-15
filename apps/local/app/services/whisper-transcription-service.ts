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
import { copyMkvSpan } from "./mkv-span";
import { assertUnderEffect } from "./assert-under";

/**
 * How `extractAudio` encodes: a Clip's range at 384kbps as recorded, or a whole
 * Footage file (or a chunk of one) mono at 64kbps.
 */
const CLIP_AUDIO = ["-b:a", "384k"] as const;
const FOOTAGE_AUDIO = ["-ac", "1", "-b:a", "64k"] as const;

/**
 * Every ffmpeg here runs at the lowest CPU priority (#2224): a Clip is
 * transcribed while its take is still recording, and nothing here may take
 * time from the capture.
 */
const LOW_PRIORITY = ["nice", "-n", "19"] as const;

/**
 * The ffmpeg arguments that cut out of `spanFile` (a copy of only the
 * Clusters around the range, `mkv-span.ts`) the very audio
 * `-ss startTime -t duration` reads from the whole file. `-copyts` keeps the
 * file's own timestamps; like `-ss`, the cut counts from the file's
 * `start_time`.
 */
export const spanCutArgs = (
  spanFile: string,
  range: { startTime: number; duration: number },
  fileStartSeconds: number
) => [
  "-copyts",
  "-i",
  spanFile,
  "-vn",
  "-af",
  `atrim=start=${range.startTime + fileStartSeconds}:duration=${range.duration},asetpts=PTS-STARTPTS`,
];

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

        // A Clip of a Matroska file (a take's mic.mkv, maybe still growing,
        // with no Cues to seek by) is read from a copy of only its Clusters:
        // ffmpeg -ss would read the whole file up to it (#2224).
        const spanFile = yield* assertUnderEffect(
          outputDir,
          `${outputFile}.span.mkv`
        ).pipe(
          Effect.mapError(
            (e) =>
              new CouldNotExtractAudioError({ cause: e, message: e.message })
          )
        );
        const span =
          range !== undefined &&
          encoding === CLIP_AUDIO &&
          inputVideo.toLowerCase().endsWith(".mkv") &&
          (yield* Effect.tryPromise(() =>
            copyMkvSpan(
              inputVideo,
              spanFile,
              range.startTime,
              range.startTime + range.duration
            )
          ).pipe(
            Effect.catchAll((error) =>
              Effect.logWarning(
                `Could not read the span of ${inputVideo}; reading it whole`,
                error
              ).pipe(Effect.as(null))
            )
          ));

        const inputArgs =
          span && range
            ? spanCutArgs(spanFile, range, span.startSeconds)
            : [
                ...(range
                  ? [
                      "-ss",
                      range.startTime.toString(),
                      "-t",
                      range.duration.toString(),
                    ]
                  : []),
                "-i",
                inputVideo,
                "-vn",
              ];

        const code = yield* Command.exitCode(
          Command.make(
            ...LOW_PRIORITY,
            "ffmpeg",
            "-y",
            "-hide_banner",
            ...inputArgs,
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
          ),
          Effect.ensuring(
            span ? removeBestEffort(effectFs, spanFile) : Effect.void
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
        transcribeFootageFile,
      };
    }),
    dependencies: [NodeContext.layer, FFmpegCommandsService.Default],
  }
) {}
