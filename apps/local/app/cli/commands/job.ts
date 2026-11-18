import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { JOB_STATUSES } from "@/db/schema";
import { NEEDS_THE_JOB_QUEUE, requireLocalMachine } from "@/cli/local-only";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
} from "@/cli/helpers";
import { draftIdOption, optionalDraftId } from "../entity-id";
import { withSidecarDatabase } from "./sidecar-database";
import {
  jobDetail,
  jobRow,
  timeoutMsOf,
  timeoutOption,
  waitAndEmit,
} from "./job-wait";
import { GET_HELP, HELP, LIST_HELP, WAIT_HELP } from "./job.help";

const requireJobQueue = (verb: string) =>
  requireLocalMachine(`cvm job ${verb}`, NEEDS_THE_JOB_QUEUE);

const jobIdArg = Args.text({ name: "jobId" });

// ---------------------------------------------------------------------------
// job get
// ---------------------------------------------------------------------------

const getCmd = Command.make("get", { jobId: jobIdArg }, ({ jobId }) =>
  Effect.gen(function* () {
    yield* requireJobQueue("get");
    yield* withSidecarDatabase(
      Effect.gen(function* () {
        const job = yield* Effect.flatMap(JobOperationsService, (ops) =>
          ops.getJob(jobId)
        );
        if (!job) return yield* notFound("job", jobId);
        yield* emitObject(yield* jobDetail(job));
      })
    );
  })
).pipe(Command.withDescription(detail(GET_HELP)));

// ---------------------------------------------------------------------------
// job list
// ---------------------------------------------------------------------------

const listCmd = Command.make(
  "list",
  {
    kind: Options.text("kind").pipe(
      Options.withDescription("only Jobs of this kind (youtube, export, …)"),
      Options.optional
    ),
    status: Options.choice("status", JOB_STATUSES).pipe(
      Options.withDescription("only Jobs with this status"),
      Options.optional
    ),
    video: draftIdOption("video", "video").pipe(
      Options.withDescription("only Jobs about this Video"),
      Options.optional
    ),
    limit: Options.integer("limit").pipe(
      Options.withDescription("at most this many Jobs (default 50)"),
      Options.withDefault(50)
    ),
  },
  ({ kind, status, video, limit }) =>
    Effect.gen(function* () {
      yield* requireJobQueue("list");
      if (limit < 1) {
        return yield* parseError("--limit must be at least 1", "job");
      }
      const videoId = yield* optionalDraftId(video);
      yield* withSidecarDatabase(
        Effect.gen(function* () {
          const ops = yield* JobOperationsService;
          const jobs = yield* ops.listJobs({
            kind: Option.getOrUndefined(kind),
            status: Option.getOrUndefined(status),
            videoId,
            limit,
          });
          yield* emitNdjson(jobs.map(jobRow));
        })
      );
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

// ---------------------------------------------------------------------------
// job wait
// ---------------------------------------------------------------------------

const waitCmd = Command.make(
  "wait",
  { timeout: timeoutOption, jobIds: jobIdArg.pipe(Args.atLeast(1)) },
  ({ timeout, jobIds }) =>
    Effect.gen(function* () {
      yield* requireJobQueue("wait");
      const timeoutMs = yield* timeoutMsOf(timeout);
      yield* withSidecarDatabase(
        Effect.gen(function* () {
          yield* emitNdjson(yield* waitAndEmit({ jobIds, timeoutMs }));
        })
      );
    })
).pipe(Command.withDescription(detail(WAIT_HELP)));

export const jobCommand = Command.make("job").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([getCmd, listCmd, waitCmd])
);
