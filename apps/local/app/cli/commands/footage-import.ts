import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Data, Effect, Logger, LogLevel, Option } from "effect";
import path from "node:path";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import {
  IMPORTED_FOOTAGE_FOLDER,
  isFootageFileName,
  toRootRelative,
} from "@/packages/storage";
import {
  asFootageImportError,
  chooseImportDestination,
} from "@/packages/storage/import";
import { readStorageRootsSync } from "@/services/storage-roots";
import { readFootageTranscript } from "@/services/footage-cache";
import {
  FootageProbe,
  probeWithFfprobe,
  type FootageProbeResult,
} from "@/services/footage-probe";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { IMPORT_FOOTAGE_JOB_KIND } from "@/features/jobs/import-footage-job";
import { TRANSCRIBE_FOOTAGE_JOB_KIND } from "@/features/jobs/transcribe-footage-job";
import { detail, emitObject, parseError } from "@/cli/helpers";
import { CliOutput } from "@/cli/output";
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { waitForFootageTranscription } from "./footage-transcribe-wait";
import { requireLocalFootage, withFootageJobs } from "./footage-jobs";
import { IMPORT_HELP } from "./footage.help";

/** How far a display aspect ratio may be from 16:9 and still be 16:9. */
const SIXTEEN_NINE_TOLERANCE = 0.01;

/**
 * Why a probed file is not 16:9 Imported Footage, naming what was found, or
 * null. The display aspect ratio is width × sample aspect ratio ÷ height.
 */
export const notSixteenNine = (probe: FootageProbeResult): string | null => {
  if (probe.video === null) return "it has no video stream";
  const { width, height, sampleAspectRatio } = probe.video;
  const [num, den] = (sampleAspectRatio ?? "1:1").split(":").map(Number);
  const sar = num && den ? num / den : 1;
  const ratio = (width * sar) / height;
  if (Math.abs(ratio / (16 / 9) - 1) <= SIXTEEN_NINE_TOLERANCE) return null;
  return `it is ${width}x${height}${sar === 1 ? "" : ` (sample aspect ratio ${sampleAspectRatio})`}, a display aspect ratio of ${ratio.toFixed(3)}:1, not 16:9 (1.778:1)`;
};

/** The import Job was cut off and not put back. Running it again redoes it. */
export class FootageImportInterruptedError extends Data.TaggedError(
  "FootageImportInterruptedError"
)<{ readonly jobId: string; readonly message: string }> {}

/** Follow the import Job until it succeeds, or end as it did. */
const waitForImport = Effect.fn("waitForImport")(function* (jobId: string) {
  const ops = yield* JobOperationsService;
  while (true) {
    const job = yield* ops.getJob(jobId);
    if (job?.status === "succeeded") return;
    if (job === null || job === undefined || job.status === "failed") {
      const error = job?.error as { tag?: string; message?: string } | null;
      return yield* Effect.fail({
        _tag: error?.tag ?? "FootageImportError",
        message: error?.message ?? `the import Job ${jobId} is gone`,
      });
    }
    if (job.status === "interrupted" || job.status === "cancelled") {
      return yield* new FootageImportInterruptedError({
        jobId,
        message: `the import was cut off (its Sidecar stopped) and no file was placed: run 'cvm footage import' again`,
      });
    }
    yield* Effect.sleep(1_000);
  }
});

const refuse = (file: string, why: string) =>
  parseError(`not imported: ${file}: ${why}. Nothing was copied.`, "footage");

/** The file's probe, or a refusal: not a video file, unreadable, not 16:9. */
const probeOrRefuse = Effect.fn("probeOrRefuse")(function* (source: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(source).pipe(Effect.option);
  if (Option.isNone(info) || info.value.type !== "File") {
    return yield* parseError(`no such file to import: ${source}`, "footage");
  }
  if (!isFootageFileName(source)) {
    return yield* refuse(source, "it is not a video file");
  }
  const prober = yield* Effect.serviceOption(FootageProbe);
  const probe = yield* Option.match(prober, {
    onSome: (p) => p.probe(source),
    onNone: () => probeWithFfprobe(source),
  }).pipe(
    Effect.catchTag("FootageUnreadableError", (e) =>
      refuse(source, `ffprobe can't read it (${e.message})`)
    )
  );
  const why = notSixteenNine(probe);
  if (why !== null || probe.video === null) {
    return yield* refuse(source, why ?? "it has no video stream");
  }
  return { ...probe.video, durationSeconds: probe.durationSeconds };
});

/** Where the copy goes, root-relative too, and what is already done there. */
const planImport = Effect.fn("planImport")(function* (source: string) {
  const roots = yield* Effect.try({
    try: () => readStorageRootsSync(),
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  }).pipe(Effect.catchAll((message) => parseError(message, "footage")));
  const { destination, existing } = yield* Effect.tryPromise({
    try: () =>
      chooseImportDestination(
        source,
        path.join(roots[0], IMPORTED_FOOTAGE_FOLDER)
      ),
    catch: asFootageImportError,
  });
  const transcribed = existing
    ? (yield* readFootageTranscript(destination)) !== null
    : false;
  return {
    destination,
    relative: toRootRelative(destination, roots),
    existing,
    transcribed,
  };
});

type ImportPlan = Effect.Effect.Success<ReturnType<typeof planImport>>;

/** The copy (unless it is there), then its transcription (unless fresh). */
const enqueueImport = Effect.fn("enqueueImport")(function* (
  source: string,
  plan: ImportPlan
) {
  const { destination } = plan;
  const subject = { type: "footage", id: destination };
  const importJob = plan.existing
    ? null
    : yield* enqueueJob({
        id: null,
        kind: IMPORT_FOOTAGE_JOB_KIND,
        title: `Import ${path.basename(destination)}`,
        params: { source, destination },
        dependsOn: null,
        subject,
        attemptsSpent: 0,
        registry: JOB_KIND_SPECS,
      });
  const transcribeJob = plan.transcribed
    ? null
    : yield* enqueueJob({
        id: null,
        kind: TRANSCRIBE_FOOTAGE_JOB_KIND,
        title: `Transcribe ${path.basename(destination)}`,
        params: { path: destination },
        dependsOn: importJob?.id ?? null,
        subject,
        attemptsSpent: 0,
        registry: JOB_KIND_SPECS,
      });
  // Best effort, and silent: a Sidecar that is down finds the Jobs when it
  // starts, and the CLI's STDERR is its error contract.
  yield* nudgeSidecar().pipe(Logger.withMinimumLogLevel(LogLevel.None));
  return {
    importJobId: importJob?.id ?? null,
    transcribeJobId: transcribeJob?.id ?? null,
  };
});

/** Wait for both Jobs, then what the import is: its file and transcript. */
const waitForImported = Effect.fn("waitForImported")(function* (
  jobs: Effect.Effect.Success<ReturnType<typeof enqueueImport>>,
  destination: string
) {
  if (jobs.importJobId) yield* waitForImport(jobs.importJobId);
  if (jobs.transcribeJobId) {
    const out = yield* CliOutput;
    yield* waitForFootageTranscription({
      jobId: jobs.transcribeJobId,
      path: destination,
      pollMs: 1_000,
      onWaiting: (line) => out.stderr(JSON.stringify(line) + "\n"),
    });
  }
  const fs = yield* FileSystem.FileSystem;
  const transcript = yield* readFootageTranscript(destination);
  return {
    size: Number((yield* fs.stat(destination)).size),
    transcript: {
      words: transcript?.words.length ?? 0,
      segments: transcript?.segments.length ?? 0,
    },
  };
});

export const importCmd = Command.make(
  "import",
  {
    file: Args.text({ name: "file" }),
    noWait: Options.boolean("no-wait").pipe(
      Options.withDescription(
        "queue the import and its transcription, print their ids, and return"
      )
    ),
  },
  ({ file, noWait }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
      const source = path.resolve(file);
      // Probed before anything is copied or queued.
      const video = yield* probeOrRefuse(source);
      const plan = yield* planImport(source);
      const run = Effect.gen(function* () {
        const jobs = yield* enqueueImport(source, plan);
        if (noWait) {
          return yield* emitObject({
            jobId: jobs.importJobId,
            transcribeJobId: jobs.transcribeJobId,
            status:
              jobs.importJobId || jobs.transcribeJobId ? "queued" : "imported",
            path: plan.relative,
          });
        }
        const imported = yield* waitForImported(jobs, plan.destination);
        yield* emitObject({
          path: plan.relative,
          size: imported.size,
          width: video.width,
          height: video.height,
          durationSeconds: video.durationSeconds,
          transcript: imported.transcript,
        });
      });
      return yield* withFootageJobs(run);
    })
).pipe(Command.withDescription(detail(IMPORT_HELP)));
