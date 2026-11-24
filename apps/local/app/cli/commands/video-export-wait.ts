import { Data, Duration, Effect, Option, Schema } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { EXPORT_EVENTS, ExportedEvent } from "@/features/jobs/export-job";
import { ExportError } from "@/services/course-publish-errors";
import { nowMs } from "@/packages/clock";

export class ExportJobFailedError extends Data.TaggedError(
  "ExportJobFailedError"
)<{
  readonly jobId: string;
  readonly message: string;
  readonly failedWith: string | null;
}> {}

export class ExportInterruptedError extends Data.TaggedError(
  "ExportInterruptedError"
)<{ readonly jobId: string; readonly message: string }> {}

export class ExportCancelledError extends Data.TaggedError(
  "ExportCancelledError"
)<{ readonly jobId: string; readonly message: string }> {}

export class ExportLostError extends Data.TaggedError("ExportLostError")<{
  readonly jobId: string;
  readonly message: string;
}> {}

export class ExportWaitTimeoutError extends Data.TaggedError(
  "ExportWaitTimeoutError"
)<{
  readonly jobId: string;
  readonly log: string;
  readonly message: string;
}> {}

const decodeExported = Schema.decodeUnknownOption(ExportedEvent);

const RecordedJobError = Schema.Struct({
  tag: Schema.optional(Schema.NullOr(Schema.String)),
  message: Schema.optional(Schema.String),
});

const decodeJobError = Schema.decodeUnknown(RecordedJobError);

const rebuildFailure = (jobId: string, recorded: unknown) =>
  decodeJobError(recorded).pipe(
    Effect.catchAll((parseError) =>
      Effect.logWarning(
        `video export: the Export Job ${jobId}'s recorded error is unreadable`,
        { error: recorded, parseError: parseError.message }
      ).pipe(Effect.as({ tag: null, message: undefined }))
    ),
    Effect.map((error) => {
      const message = error.message ?? "the Export failed";
      return error.tag === "ExportError"
        ? new ExportError({ message })
        : new ExportJobFailedError({
            jobId,
            message,
            failedWith: error.tag ?? null,
          });
    })
  );

const followExport = Effect.fn("followExport")(function* (input: {
  readonly jobId: string;
  readonly pollMs: number;
  readonly onWaiting: (line: Record<string, unknown>) => Effect.Effect<void>;
}) {
  const ops = yield* JobOperationsService;
  let warnedNoSidecar = false;
  while (true) {
    const job = yield* ops.getJob(input.jobId);
    if (!job) {
      return yield* new ExportLostError({
        jobId: input.jobId,
        message: `no Job ${input.jobId}: it was never enqueued, or was deleted`,
      });
    }
    switch (job.status) {
      case "succeeded": {
        const events = yield* ops.listJobEvents(job.id);
        const exported = Option.flatMap(
          Option.fromNullable(
            events.findLast((e) => e.type === EXPORT_EVENTS.exported)
          ),
          (event) => decodeExported(event.data)
        );
        if (Option.isSome(exported)) return exported.value.path;
        return yield* new ExportLostError({
          jobId: job.id,
          message: `the Export Job ${job.id} succeeded but did not record its file: look in finished-videos/`,
        });
      }
      case "failed":
        return yield* Effect.flip(rebuildFailure(job.id, job.error));
      case "interrupted":
        return yield* new ExportInterruptedError({
          jobId: job.id,
          message: `the Export Job ${job.id} was cut off (its Sidecar stopped). Run 'cvm video export' again.`,
        });
      case "cancelled":
        return yield* new ExportCancelledError({
          jobId: job.id,
          message: `the Export was cancelled (Job ${job.id}). Run 'cvm video export' again to start a new one.`,
        });
      case "queued": {
        if (!warnedNoSidecar) {
          const lease = yield* ops.getSidecarLease();
          if (!lease || lease.leaseUntil.getTime() < nowMs()) {
            warnedNoSidecar = true;
            yield* input.onWaiting({
              event: "waiting",
              jobId: job.id,
              message:
                "the sidecar is not running: the Export starts when it does (`pnpm dev` or `pnpm start` runs it)",
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

export const waitForExport = (input: {
  readonly jobId: string;
  readonly log: string;
  readonly pollMs: number;
  readonly timeoutMs: number;
  readonly onWaiting: (line: Record<string, unknown>) => Effect.Effect<void>;
}) =>
  followExport(input).pipe(
    Effect.timeoutFail({
      duration: Duration.millis(input.timeoutMs),
      onTimeout: () =>
        new ExportWaitTimeoutError({
          jobId: input.jobId,
          log: input.log,
          message: `the Export Job ${input.jobId} had not finished after ${input.timeoutMs / 1000}s. It is still going: run the same 'cvm video export' again to keep waiting on it (it starts no second Export), or pass a longer --timeout.`,
        }),
    })
  );
