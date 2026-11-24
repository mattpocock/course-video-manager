import { Command, Options } from "@effect/cli";
import { Effect, Logger, LogLevel } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { EXPORT_JOB_KIND } from "@/features/jobs/export-job";
import {
  NEEDS_THE_SIDECAR_TO_EXPORT,
  requireLocalMachine,
} from "@/cli/local-only";
import { detail, emitObject, notFound, parseError } from "@/cli/helpers";
import { CliOutput } from "@/cli/output";
import { draftIdArg } from "../entity-id";
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { withFootageJobs } from "./footage-jobs";
import { jobLogPath, waitForExport } from "./video-export-wait";
import { EXPORT_HELP } from "./video.export.help";

const DEFAULT_TIMEOUT_SECONDS = 3_600;

const POLL_MS = 1_000;

const EXPORT_JOINING_A_LIVE_EXPORT = {
  [EXPORT_JOB_KIND]: { ...JOB_KIND_SPECS.export, coveredBy: () => true },
};

const noWaitOption = Options.boolean("no-wait").pipe(
  Options.withDescription(
    "enqueue the Export Job and print its id, without waiting for it"
  )
);

const timeoutOption = Options.integer("timeout").pipe(
  Options.withDefault(DEFAULT_TIMEOUT_SECONDS),
  Options.withDescription(
    "seconds to wait for the Export before giving up on the wait (the Export goes on); default 3600"
  )
);

export const exportCommand = Command.make(
  "export",
  { id: draftIdArg("video"), noWait: noWaitOption, timeout: timeoutOption },
  ({ id: ref, noWait, timeout }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine(
        "cvm video export",
        NEEDS_THE_SIDECAR_TO_EXPORT
      );
      if (timeout < 1) {
        return yield* parseError(
          `--timeout must be at least 1 second, not ${timeout}`,
          "video"
        );
      }
      const videoId = yield* ref;
      const video = yield* Effect.flatMap(VideoOperationsService, (svc) =>
        svc.getVideoWithClipsById(videoId)
      ).pipe(
        Effect.catchTag("NotFoundError", () => notFound("video", videoId))
      );

      const run = Effect.gen(function* () {
        const job = yield* enqueueJob({
          id: null,
          kind: EXPORT_JOB_KIND,
          title: video.title,
          params: { videoId },
          dependsOn: null,
          subject: { type: "video", id: videoId },
          attemptsSpent: 0,
          registry: EXPORT_JOINING_A_LIVE_EXPORT,
        });
        yield* nudgeSidecar().pipe(Logger.withMinimumLogLevel(LogLevel.None));

        if (noWait) {
          return yield* emitObject({
            videoId,
            jobId: job.id,
            status: job.status,
            log: jobLogPath(job.id),
          });
        }

        const out = yield* CliOutput;
        const path = yield* waitForExport({
          jobId: job.id,
          pollMs: POLL_MS,
          timeoutMs: timeout * 1_000,
          onWaiting: (line) => out.stderr(JSON.stringify(line) + "\n"),
        });
        yield* emitObject({
          videoId,
          jobId: job.id,
          status: "succeeded",
          path,
        });
      });

      return yield* withFootageJobs(run);
    })
).pipe(Command.withDescription(detail(EXPORT_HELP)));
