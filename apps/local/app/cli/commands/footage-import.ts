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
import {
  readStorageRootsSync,
  storageRootsConfig,
} from "@/services/storage-roots";
import {
  enqueueFootageTranscription,
  findYoutubeFootage,
  readYoutubeSource,
  startYoutubeImport,
} from "@/services/youtube-footage-import.server";
import { isWebUrl } from "@/features/imported-footage/youtube-footage";
import { readFootageTranscript } from "@/services/footage-cache";
import { notSixteenNine, probeFootage } from "@/services/footage-probe";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { IMPORT_FOOTAGE_JOB_KIND } from "@/features/jobs/import-footage-job";
import { TRANSCRIBE_FOOTAGE_JOB_KIND } from "@/features/jobs/transcribe-footage-job";
import { detail, emitObject, parseError } from "@/cli/helpers";
import { CliOutput } from "@/cli/output";
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { waitForFootageTranscription } from "./footage-transcribe-wait";
import { requireLocalFootage, withFootageJobs } from "./footage-jobs";
import { IMPORT_HELP } from "./footage.help";

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
  const probe = yield* probeFootage(source).pipe(
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

/**
 * `cvm footage import <youtube-url>`: the download is a Job (the 16:9 check
 * is made there, after it), then the same transcription as a file's.
 */
const importYoutube = Effect.fn("importYoutube")(function* (
  url: string,
  noWait: boolean
) {
  const started = yield* startYoutubeImport(url).pipe(
    Effect.catchTag("NotYoutubeVideoUrlError", (e) =>
      parseError(e.message, "footage")
    )
  );
  if (noWait) {
    return yield* emitObject({
      jobId: started.jobId,
      transcribeJobId: started.transcribeJobId,
      status: started.jobId || started.transcribeJobId ? "queued" : "imported",
      path: started.path,
    });
  }
  if (started.jobId) yield* waitForImport(started.jobId);
  const roots = yield* storageRootsConfig;
  const found = yield* findYoutubeFootage(roots, started.videoId);
  if (found === null) {
    return yield* new FootageImportInterruptedError({
      jobId: started.jobId ?? "",
      message: `the import of ${url} ended but no file for ${started.videoId} is under raw-footage/imported/: run 'cvm footage import' again`,
    });
  }
  const destination = path.join(found.location, found.path);
  // The Job queued the transcription: this finds it (or a fresh transcript).
  const transcribeJob = yield* enqueueFootageTranscription(destination);
  const imported = yield* waitForImported(
    { importJobId: null, transcribeJobId: transcribeJob?.id ?? null },
    destination
  );
  const video = yield* probeOrRefuse(destination);
  const source = yield* readYoutubeSource(destination);
  yield* emitObject({
    path: found.path,
    size: imported.size,
    width: video.width,
    height: video.height,
    durationSeconds: video.durationSeconds,
    transcript: imported.transcript,
    title: source?.title ?? null,
    url: source?.url ?? null,
  });
});

export const importCmd = Command.make(
  "import",
  {
    file: Args.text({ name: "file-or-youtube-url" }),
    noWait: Options.boolean("no-wait").pipe(
      Options.withDescription(
        "queue the import and its transcription, print their ids, and return"
      )
    ),
  },
  ({ file, noWait }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
      if (isWebUrl(file)) {
        return yield* withFootageJobs(importYoutube(file, noWait));
      }
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
