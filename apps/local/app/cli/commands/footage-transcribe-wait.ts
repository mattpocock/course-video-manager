import { Data, Effect } from "effect";
import {
  JobOperationsService,
  type JobEvent,
} from "@cvm/core/services/db-job-operations.server";
import { readFootageSidecar, sidecarPathFor } from "@/services/footage-cache";
import { FOOTAGE_TRANSCRIPTION_EVENTS } from "@/features/jobs/transcribe-footage-job";
import { parseError } from "@/cli/helpers";
import { nowMs } from "@/packages/clock";

/**
 * `cvm footage transcribe`: follow the `transcribe-footage` Job the Sidecar
 * runs until it settles, and end as the in-process command did — the same
 * summary on STDOUT on success, the same tagged error (and so the same exit
 * code) on failure.
 */

/** What the command prints: the transcript's summary, counts not arrays. */
export interface FootageTranscribeSummary {
  readonly path: string;
  readonly sidecar: string;
  readonly sourceHash: string;
  readonly transcribedAt: string;
  readonly words: number;
  readonly segments: number;
}

/**
 * The Job was cut off and not put back (its Sidecar died, so the run was
 * lost). Running the command again resumes: the chunks Whisper already
 * answered are cached beside the file.
 */
export class FootageTranscriptionInterruptedError extends Data.TaggedError(
  "FootageTranscriptionInterruptedError"
)<{ readonly jobId: string; readonly message: string }> {}

/** The Job is gone, or succeeded without leaving a transcript to read. */
export class FootageTranscriptionLostError extends Data.TaggedError(
  "FootageTranscriptionLostError"
)<{ readonly jobId: string; readonly message: string }> {}

/**
 * The service's own failure, as the Job recorded it: its `_tag` and message,
 * so a Whisper failure still ends `CouldNotTranscribeError`, exit 4.
 */
export interface FootageJobFailure {
  readonly _tag: string;
  readonly message: string;
}

/** The Job's tag for a footage file that vanished before it ran. */
const FILE_MISSING_TAG = "FootageFileMissingError";

const summaryOf = (data: unknown): FootageTranscribeSummary | null => {
  const d = (data ?? {}) as Record<string, unknown>;
  return typeof d.path === "string" &&
    typeof d.sidecar === "string" &&
    typeof d.sourceHash === "string" &&
    typeof d.transcribedAt === "string" &&
    typeof d.words === "number" &&
    typeof d.segments === "number"
    ? {
        path: d.path,
        sidecar: d.sidecar,
        sourceHash: d.sourceHash,
        transcribedAt: d.transcribedAt,
        words: d.words,
        segments: d.segments,
      }
    : null;
};

/**
 * The summary of a Job that succeeded: from its `footage-transcribed` Job
 * Event, or — that write is best effort — from the transcript it wrote.
 */
const resultOf = (jobId: string, path: string, events: readonly JobEvent[]) =>
  Effect.gen(function* () {
    const done = events.findLast(
      (e) => e.type === FOOTAGE_TRANSCRIPTION_EVENTS.transcribed
    );
    const fromEvent = summaryOf(done?.data);
    if (fromEvent) return fromEvent;
    const sidecar = yield* readFootageSidecar(path).pipe(
      Effect.orElseSucceed(() => null)
    );
    if (!sidecar) {
      return yield* new FootageTranscriptionLostError({
        jobId,
        message: `the transcription Job ${jobId} succeeded, but no transcript is beside ${path}: run 'cvm footage transcribe' again`,
      });
    }
    return {
      path: sidecar.sourcePath,
      sidecar: sidecarPathFor(path),
      sourceHash: sidecar.sourceHash,
      transcribedAt: sidecar.transcribedAt,
      words: sidecar.words.length,
      segments: sidecar.segments.length,
    } satisfies FootageTranscribeSummary;
  });

export const waitForFootageTranscription = Effect.fn(
  "waitForFootageTranscription"
)(function* (input: {
  readonly jobId: string;
  readonly path: string;
  readonly pollMs: number;
  /** A line for STDERR: only ever that the Sidecar is not running. */
  readonly onWaiting: (line: Record<string, unknown>) => Effect.Effect<void>;
}) {
  const ops = yield* JobOperationsService;
  let warnedNoSidecar = false;
  while (true) {
    const job = yield* ops.getJob(input.jobId);
    if (!job) {
      return yield* new FootageTranscriptionLostError({
        jobId: input.jobId,
        message: `no Job ${input.jobId}: it was never enqueued, or was deleted`,
      });
    }
    switch (job.status) {
      case "succeeded":
        return yield* resultOf(
          job.id,
          input.path,
          yield* ops.listJobEvents(job.id)
        );
      case "failed": {
        const error = job.error as {
          tag?: string | null;
          message?: string;
        } | null;
        const message = error?.message ?? "the footage transcription failed";
        if (error?.tag === FILE_MISSING_TAG) {
          return yield* parseError(message, "footage");
        }
        return yield* Effect.fail<FootageJobFailure>({
          _tag: error?.tag ?? "FootageTranscriptionFailedError",
          message,
        });
      }
      case "interrupted":
      case "cancelled":
        return yield* new FootageTranscriptionInterruptedError({
          jobId: job.id,
          message: `the transcription of ${input.path} was cut off (its Sidecar stopped). Run 'cvm footage transcribe' again: the chunks Whisper already answered are cached and are not sent again.`,
        });
      case "queued": {
        if (!warnedNoSidecar) {
          const lease = yield* ops.getSidecarLease();
          if (!lease || lease.leaseUntil.getTime() < nowMs()) {
            warnedNoSidecar = true;
            yield* input.onWaiting({
              event: "waiting",
              message:
                "the sidecar is not running: the transcription starts when it does (`pnpm dev` or `pnpm start` runs it)",
            });
          }
        }
        break;
      }
      case "running":
        break;
    }
    yield* Effect.sleep(input.pollMs);
  }
});
