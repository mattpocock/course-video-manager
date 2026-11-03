import { Command, Options } from "@effect/cli";
import { Effect, Logger, LogLevel } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { RENDER_VERTICAL_JOB_KIND } from "@/features/jobs/render-vertical-job";
import {
  NEEDS_THE_SIDECAR_TO_RENDER,
  requireLocalMachine,
} from "@/cli/local-only";
import { detail, emitObject, notFound, parseError } from "@/cli/helpers";
import { CliOutput } from "@/cli/output";
import { draftIdArg } from "../entity-id";
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { withFootageJobs } from "./footage-jobs";
import { waitForShortRender } from "./short-render-wait";
import { HELP, RENDER_HELP } from "./short.help";
import { createCmd } from "./short-create";
import { postCmd, queueCmd } from "./short-post";

// ---------------------------------------------------------------------------
// short render
// ---------------------------------------------------------------------------

const noWaitOption = Options.boolean("no-wait").pipe(
  Options.withDescription(
    "enqueue the render Job and print its id, without waiting for it"
  )
);

const renderCmd = Command.make(
  "render",
  { id: draftIdArg("video"), noWait: noWaitOption },
  ({ id: ref, noWait }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine(
        "cvm short render",
        NEEDS_THE_SIDECAR_TO_RENDER
      );
      const videoId = yield* ref;
      const video = yield* Effect.flatMap(VideoOperationsService, (svc) =>
        svc.getVideoWithClipsById(videoId)
      ).pipe(
        Effect.catchTag("NotFoundError", () => notFound("video", videoId))
      );
      if (video.format !== "short") {
        return yield* parseError(
          `${videoId} is a Landscape Video: only a Short renders vertically`,
          "video"
        );
      }

      const run = Effect.gen(function* () {
        const job = yield* enqueueJob({
          id: null,
          kind: RENDER_VERTICAL_JOB_KIND,
          title: video.title,
          params: { videoId },
          dependsOn: null,
          subject: { type: "video", id: videoId },
          attemptsSpent: 0,
          registry: JOB_KIND_SPECS,
        });
        // Best effort, and silent: a sidecar that is down finds the Job when
        // it starts, and the CLI's STDERR is its error contract.
        yield* nudgeSidecar().pipe(Logger.withMinimumLogLevel(LogLevel.None));

        if (noWait) {
          return yield* emitObject({
            jobId: job.id,
            status: "queued",
            videoId,
            log: `.data/logs/jobs/${job.id}.jsonl`,
          });
        }

        const out = yield* CliOutput;
        const path = yield* waitForShortRender({
          jobId: job.id,
          pollMs: 1_000,
          onWaiting: (line) => out.stderr(JSON.stringify(line) + "\n"),
        });
        yield* emitObject({ videoId, path });
      });

      return yield* withFootageJobs(run);
    })
).pipe(Command.withDescription(detail(RENDER_HELP)));

export const shortCommand = Command.make("short").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([createCmd, renderCmd, postCmd, queueCmd])
);
