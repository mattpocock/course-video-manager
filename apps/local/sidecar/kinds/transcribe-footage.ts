import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import {
  hashFootage,
  sidecarPathFor,
  writeFootageTranscript,
} from "@/services/footage-cache";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { FOOTAGE_TRANSCRIPTION_EVENTS } from "@/features/jobs/transcribe-footage-job";
import { footageChunkCache } from "../footage-chunk-cache";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { FOOTAGE_TRANSCRIPTION_POLICY } from "../retry-policy";

export class FootageFileMissingError extends Data.TaggedError(
  "FootageFileMissingError"
)<{ readonly path: string; readonly message: string }> {}

/**
 * **Footage transcription** (#16 in docs/plans/background-jobs-sidecar.md),
 * enqueued by `cvm footage transcribe`: the whole file through Whisper (in
 * silence-aligned chunks when it is long), and its transcript written beside
 * it (`<path>.transcript.json`). The Sidecar runs it with the same
 * `WhisperTranscriptionService`, and so the same Whisper permits, as a Clip
 * transcription.
 *
 * A deliberate stop (`tsx watch` restarting, Ctrl-C) puts the Job back, and
 * the next run resumes from the chunk cache (`footage-chunk-cache.ts`): a
 * chunk Whisper already answered is not sent again. 1 attempt, as the
 * in-process command had (`FOOTAGE_TRANSCRIPTION_POLICY`).
 */
export const transcribeFootageJobKind = defineJobKind({
  ...FOOTAGE_TRANSCRIPTION_POLICY,
  params: JOB_PARAMS["transcribe-footage"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sourcePath = params.path;
      if (!(yield* fs.exists(sourcePath))) {
        return yield* new FootageFileMissingError({
          path: sourcePath,
          message: `no such footage file: ${sourcePath}`,
        });
      }

      // Hashed first: the chunk cache is keyed by it, so a file replaced
      // between two runs never reuses the old file's chunks. Its stamp lets a
      // later read trust the hash without hashing again.
      const { hash: sourceHash, stamp: sourceStamp } =
        yield* hashFootage(sourcePath);
      const cache = footageChunkCache(sourcePath, sourceHash);
      yield* Effect.logInfo("transcribe-footage: started", {
        path: sourcePath,
        sourceHash,
      });

      const whisper = yield* WhisperTranscriptionService;
      const transcript = yield* whisper.transcribeFootageFile(sourcePath, {
        cache,
        onChunk: (chunk) =>
          Effect.logInfo("transcribe-footage: chunk", chunk).pipe(
            Effect.zipRight(
              ctx.emit(FOOTAGE_TRANSCRIPTION_EVENTS.chunkSettled, { ...chunk })
            )
          ),
      });

      const sidecar = yield* writeFootageTranscript({
        sourcePath,
        sourceHash,
        sourceStamp,
        transcript,
      });
      yield* cache.clear;

      const summary = {
        path: sidecar.sourcePath,
        sidecar: sidecarPathFor(sourcePath),
        sourceHash: sidecar.sourceHash,
        transcribedAt: sidecar.transcribedAt,
        words: sidecar.words.length,
        segments: sidecar.segments.length,
      };
      yield* Effect.logInfo("transcribe-footage: done", summary);
      yield* ctx.emit(FOOTAGE_TRANSCRIPTION_EVENTS.transcribed, summary);
    }),
});
