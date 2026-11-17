import { Data, Effect, Either } from "effect";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { footageStamp } from "@/services/footage-cache";
import {
  writePreviewLoudness,
  type PreviewLoudness,
} from "@/services/preview-loudness-cache";
import { storageRootsConfig } from "@/services/storage-roots";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { PREVIEW_LOUDNESS_POLICY } from "../retry-policy";

/** Some files could not be measured; each is recorded as failed beside it. */
export class PreviewLoudnessFailedError extends Data.TaggedError(
  "PreviewLoudnessFailedError"
)<{
  readonly failures: readonly { file: string; message: string }[];
  readonly message: string;
}> {}

/**
 * What one file came to: measured, silent, or why it failed. A failure is an
 * outcome here, not the end of the Job: it is recorded and reported.
 */
const measureOne = (file: string) =>
  Effect.gen(function* () {
    const ffmpeg = yield* FFmpegCommandsService;
    const measured = yield* Effect.either(
      ffmpeg.measureIntegratedLoudness(file)
    );
    const outcome: PreviewLoudness = Either.match(measured, {
      onLeft: (error) => ({ kind: "failed", message: error.message }),
      onRight: (lufs) =>
        lufs === null
          ? { kind: "silent" }
          : { kind: "measured", integratedLufs: lufs },
    });
    return outcome;
  });

/**
 * **Preview loudness** (#2719): each file the Video editor's preview plays,
 * measured once with ffmpeg's `ebur128` (at `nice -n 19`) and kept beside it
 * (`<file>.loudness.json`, `preview-loudness-cache.ts`), so the preview lifts
 * it to the export's loudness rather than by a flat 12 dB. The editor's
 * loader enqueues it for the files it found unmeasured, and reads the
 * measurements on its next load. Held while a Recording Session records
 * (`HELD_WHILE_RECORDING_KINDS`): a file may be the take being written.
 *
 * Every file is measured, whatever happens to the others. One that fails is
 * recorded as failed, stamped like a measurement, so the loader does not ask
 * for it again until the file changes; the Job then fails, once, naming
 * every file that did.
 */
export const measurePreviewLoudnessJobKind = defineJobKind({
  ...PREVIEW_LOUDNESS_POLICY,
  params: JOB_PARAMS["measure-preview-loudness"],
  run: (params) =>
    Effect.gen(function* () {
      const roots = yield* storageRootsConfig;
      const failures: { file: string; message: string }[] = [];
      for (const file of params.files) {
        const kept = yield* Effect.either(
          Effect.gen(function* () {
            // Stamped before the read: a file written to while it is
            // measured reads as changed, and is measured again.
            const stamp = yield* footageStamp(file);
            const outcome = yield* measureOne(file);
            // No mtime: nothing could tell a record fresh, so none is kept
            // (the loader never asks for such a file).
            if (stamp !== null) {
              yield* writePreviewLoudness({ file, stamp, outcome, roots });
            }
            return outcome;
          })
        ).pipe(
          Effect.map(
            Either.getOrElse((error): PreviewLoudness => ({
              kind: "failed",
              message: error.message,
            }))
          )
        );
        yield* Effect.logInfo("measure-preview-loudness: file", {
          file,
          ...kept,
        });
        if (kept.kind === "failed") {
          failures.push({ file, message: kept.message });
        }
      }
      if (failures.length > 0) {
        yield* Effect.logWarning("measure-preview-loudness: failed", {
          failures,
        });
        return yield* new PreviewLoudnessFailedError({
          failures,
          message: `Could not measure the preview loudness of ${failures.length} of ${params.files.length} files: ${failures.map((f) => `${f.file} (${f.message})`).join("; ")}`,
        });
      }
    }),
});
