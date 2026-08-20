import { Command, FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";
import type { FFmpegCommandsService } from "./ffmpeg-commands";
import { findSilenceInVideo } from "./silence-detection";
import {
  mergeChunkTranscripts,
  planChunkBoundaries,
  type FootageTranscript,
} from "./footage-chunking";

/**
 * Whole-file **Footage** transcription — the ffmpeg + chunking orchestration
 * behind `VideoProcessingService.transcribeFootageFile`. Split out of that
 * service purely to keep it under the repo's per-file token budget; it is not a
 * seam. `transcribeFootage` takes the service's own `transcribeAudioFile` (the
 * Whisper call, with its semaphore and API key) as a parameter, so every chunk
 * still transcribes through exactly that one path and the whole thing stays
 * fakeable by faking VideoProcessingService.
 *
 * DELIBERATELY SEPARATE from the per-clip transcription path: the audio here is
 * mono 64kbps (small enough that most files upload in one Whisper pass), never
 * the 384kbps stereo `extractAudioClip` produces.
 */

/**
 * Whisper refuses an upload over 25MB. Footage whose extracted mono-64kbps audio
 * exceeds this is transcribed in silence-aligned chunks; anything at or under it
 * is one pass.
 */
const WHISPER_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class CouldNotExtractFootageAudioError extends Data.TaggedError(
  "CouldNotExtractFootageAudioError"
)<{
  cause: unknown;
  message: string;
}> {}

/**
 * Extract footage audio as mono, 64kbps mp3. Pass a `startTime`/`durationSeconds`
 * to extract one chunk of a long file.
 */
const extractFootageAudio = Effect.fn("extractFootageAudio")(function* (
  inputVideo: string,
  startTime?: number,
  durationSeconds?: number
) {
  const fs = yield* FileSystem.FileSystem;
  const outputDir = path.join(tmpdir(), "whisper-footage-audio");
  yield* fs.makeDirectory(outputDir, { recursive: true });

  const outputHash = crypto
    .createHash("sha256")
    .update(`${inputVideo}-${startTime ?? "full"}-${durationSeconds ?? "full"}`)
    .digest("hex")
    .slice(0, 12);
  const outputFile = path.join(outputDir, `${outputHash}.mp3`);

  const args = ["-y", "-hide_banner"];
  if (startTime !== undefined) args.push("-ss", startTime.toString());
  if (durationSeconds !== undefined)
    args.push("-t", durationSeconds.toString());
  args.push(
    "-i",
    inputVideo,
    "-vn",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    outputFile
  );

  const code = yield* Command.exitCode(Command.make("ffmpeg", ...args)).pipe(
    Effect.mapError(
      (e) =>
        new CouldNotExtractFootageAudioError({
          cause: e,
          message: `Failed to extract footage audio: ${e.message}`,
        })
    )
  );
  if (code !== 0) {
    yield* new CouldNotExtractFootageAudioError({
      cause: null,
      message: `Failed to extract footage audio, exit code: ${code}`,
    });
  }

  return outputFile;
});

const getAudioDurationSeconds = Effect.fn("getAudioDurationSeconds")(function* (
  audioPath: string
) {
  const result = yield* Command.string(
    Command.make(
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath
    )
  ).pipe(
    Effect.mapError(
      (e) =>
        new CouldNotExtractFootageAudioError({
          cause: e,
          message: `Failed to read audio duration: ${e.message}`,
        })
    )
  );
  return Number(result.trim());
});

/**
 * Transcribe a whole raw footage file. Extracts the full audio (mono 64k); if it
 * fits under Whisper's 25MB cap it is one pass, otherwise the file is split into
 * ~27-minute chunks cut at detected silence (never mid-word), each transcribed
 * on its own, and the pieces' timestamps offset back onto the file's timeline
 * and merged. No diarization, ever.
 */
export const transcribeFootage = <E, R>(
  deps: {
    readonly ffmpegCommands: FFmpegCommandsService;
    readonly transcribeAudioFile: (
      audioPath: string
    ) => Effect.Effect<FootageTranscript, E, R>;
  },
  inputVideo: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const fullAudio = yield* extractFootageAudio(inputVideo);
    const stat = yield* fs.stat(fullAudio);

    if (Number(stat.size) <= WHISPER_MAX_UPLOAD_BYTES) {
      const transcription = yield* deps.transcribeAudioFile(fullAudio);
      yield* fs.remove(fullAudio).pipe(Effect.catchAll(() => Effect.void));
      return transcription;
    }

    // Too large for one upload: split at silence near the target size.
    const durationSeconds = yield* getAudioDurationSeconds(fullAudio);
    const { clips } = yield* findSilenceInVideo(
      deps.ffmpegCommands,
      inputVideo
    );
    // The end of each speaking clip is where the file falls silent — the only
    // place it is safe to cut without splitting a spoken word.
    const silencePoints = clips.map((clip) => clip.endTime);
    const boundaries = planChunkBoundaries({ durationSeconds, silencePoints });

    // Sequential: transcribeAudioFile already bounds Whisper concurrency with a
    // semaphore, and chunking exists to stay UNDER a limit, not to fan one file
    // out across the whole permit budget.
    const chunks = yield* Effect.forEach(boundaries, (boundary) =>
      Effect.gen(function* () {
        const chunkAudio = yield* extractFootageAudio(
          inputVideo,
          boundary.start,
          boundary.end - boundary.start
        );
        const transcription = yield* deps.transcribeAudioFile(chunkAudio);
        yield* fs.remove(chunkAudio).pipe(Effect.catchAll(() => Effect.void));
        return {
          offset: boundary.start,
          words: transcription.words,
          segments: transcription.segments,
        };
      })
    );

    yield* fs.remove(fullAudio).pipe(Effect.catchAll(() => Effect.void));

    return mergeChunkTranscripts(chunks);
  });
