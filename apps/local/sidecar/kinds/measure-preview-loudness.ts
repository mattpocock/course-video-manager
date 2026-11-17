import { Command } from "@effect/platform";
import { Data, Effect, Stream } from "effect";
import { footageStamp } from "@/services/footage-cache";
import { writePreviewLoudness } from "@/services/preview-loudness-cache";
import { storageRootsConfig } from "@/services/storage-roots";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { PREVIEW_LOUDNESS_POLICY } from "../retry-policy";

export class LoudnessMeasureError extends Data.TaggedError(
  "LoudnessMeasureError"
)<{
  readonly file: string;
  readonly message: string;
  readonly cause: unknown;
}> {}

/** A process run to its end: its exit code, its stdout and its stderr. */
const runToEnd = (file: string, command: Command.Command) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* Command.start(command);
      const [stdout, stderr] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ],
        { concurrency: 2 }
      );
      return { exitCode: yield* child.exitCode, stdout, stderr };
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new LoudnessMeasureError({
          file,
          cause,
          message: `Could not start ${command.toString()}: ${cause.message}`,
        })
    )
  );

/** At the lowest CPU priority, as all Sidecar ffmpeg work during a take. */
const niced = (exe: string, ...args: string[]) =>
  Command.make("nice", "-n", "19", exe, ...args);

/** ebur128's summary: `Integrated loudness:` then `I: -23.0 LUFS`. */
const INTEGRATED = /Integrated loudness:\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/;

/**
 * The integrated loudness (LUFS, EBU R128) of a file's first sound stream,
 * the one a `<video>` plays; null when it has no sound at all.
 */
export const measureIntegratedLoudness = (file: string) =>
  Effect.gen(function* () {
    const probe = yield* runToEnd(
      file,
      niced(
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        file
      )
    );
    if (probe.exitCode !== 0) {
      return yield* new LoudnessMeasureError({
        file,
        cause: null,
        message: `ffprobe could not read ${file}: ${probe.stderr.trim()}`,
      });
    }
    if (probe.stdout.trim() === "") return null;

    const run = yield* runToEnd(
      file,
      niced(
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-nostdin",
        "-i",
        file,
        "-map",
        "0:a:0",
        "-af",
        "ebur128=framelog=quiet",
        "-f",
        "null",
        "-"
      )
    );
    const match = INTEGRATED.exec(run.stderr);
    if (run.exitCode !== 0 || !match) {
      return yield* new LoudnessMeasureError({
        file,
        cause: null,
        message: `ffmpeg could not measure the loudness of ${file} (exit ${run.exitCode}): ${run.stderr.slice(-2000)}`,
      });
    }
    return Number(match[1]);
  });

/**
 * **Preview loudness** (#2719): each file the Video editor's preview plays,
 * measured once with ffmpeg's `ebur128` and kept beside it
 * (`<file>.loudness.json`, `preview-loudness-cache.ts`), so the preview lifts
 * it to the export's loudness rather than by a flat 12 dB. The editor's
 * loader enqueues it for the files it found unmeasured, and reads the
 * measurements on its next load. Held while a Recording Session records
 * (`HELD_WHILE_RECORDING_KINDS`): a file may be the take being written.
 *
 * One file at a time. A file that fails fails the Job, after the files before
 * it are kept: the rest are asked for again on the editor's next load.
 */
export const measurePreviewLoudnessJobKind = defineJobKind({
  ...PREVIEW_LOUDNESS_POLICY,
  params: JOB_PARAMS["measure-preview-loudness"],
  run: (params) =>
    Effect.gen(function* () {
      const roots = yield* storageRootsConfig;
      for (const file of params.files) {
        // Stamped before the read: a file written to while it is measured
        // reads as changed, and is measured again.
        const stamp = yield* footageStamp(file);
        const integratedLufs = yield* measureIntegratedLoudness(file);
        yield* writePreviewLoudness({ file, stamp, integratedLufs, roots });
        yield* Effect.logInfo("measure-preview-loudness: measured", {
          file,
          integratedLufs,
        });
      }
    }),
});
