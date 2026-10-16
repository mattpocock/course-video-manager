import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import {
  Config,
  ConfigProvider,
  Effect,
  Layer,
  Logger,
  LogLevel,
  Option,
} from "effect";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { findStoragePathSync } from "@/packages/storage/server";
import { readStorageRootsSync } from "@/services/storage-roots";
import path from "node:path";
import { GitWorktreeProbeLive } from "@cvm/core/git-worktree";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import {
  readFootageTranscript,
  sidecarPathFor,
} from "@/services/footage-cache";
import { TRANSCRIBE_FOOTAGE_JOB_KIND } from "@/features/jobs/transcribe-footage-job";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
} from "@/cli/helpers";
import { CliOutput } from "@/cli/output";
import { loadRepoEnv } from "@/services/repo-env";
import { NEEDS_FOOTAGE_ON_DISK, requireLocalMachine } from "@/cli/local-only";
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { waitForFootageTranscription } from "./footage-transcribe-wait";
import { FILE_NAMES } from "recorder-service/capture-args";
import {
  HELP,
  LIST_HELP,
  TRANSCRIBE_HELP,
  TRANSCRIPT_HELP,
} from "./footage.help";

// ---------------------------------------------------------------------------
// Footage is on the author's DISK, so every verb here is local-only. Each
// subcommand yields this first, before its argument is even looked at (see
// local-only.ts) — a Remote Box has no raw footage and could never succeed.
// ---------------------------------------------------------------------------

const requireLocalFootage = requireLocalMachine(
  "cvm footage",
  NEEDS_FOOTAGE_ON_DISK
);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".webm",
  ".avi",
  ".m4v",
]);

const dirOption = Options.text("dir").pipe(
  Options.withDescription(
    "Directory to list (default: OBS_RECORDING_DIR, else ~/Videos)."
  ),
  Options.optional
);

const pathArg = Args.text({ name: "path" });

// ---------------------------------------------------------------------------
// footage list
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", { dir: dirOption }, ({ dir }) =>
  Effect.gen(function* () {
    yield* requireLocalFootage;
    const fs = yield* FileSystem.FileSystem;

    // Load the repo .env so OBS_RECORDING_DIR (where old OBS Footage lives)
    // resolves, then read it via Config.
    yield* Effect.sync(() => loadRepoEnv());
    const directory = yield* Option.match(dir, {
      onSome: (d) => Effect.succeed(d),
      onNone: () =>
        Config.string("OBS_RECORDING_DIR").pipe(
          Effect.orElseSucceed(() => path.join(homedir(), "Videos"))
        ),
    }).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv()));

    const entries = yield* fs
      .readDirectory(directory)
      .pipe(
        Effect.catchAll(() =>
          parseError(`cannot read footage directory ${directory}`, "footage")
        )
      );

    const files = entries.filter((name) =>
      VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())
    );
    // The CVM recorder writes each Recording Session into a folder of its own
    // here; its mic file is the one a lost take is searched for in (a
    // CVM-recorder Clip's Footage path is that same file).
    const micFiles = yield* Effect.filter(
      entries.map((name) => path.join(name, FILE_NAMES.mic)),
      // Under a file rather than a folder, `exists` fails (ENOTDIR): not one.
      (name) =>
        fs
          .exists(path.join(directory, name))
          .pipe(Effect.orElseSucceed(() => false))
    );

    const rows = yield* Effect.forEach([...files, ...micFiles].sort(), (name) =>
      Effect.gen(function* () {
        const full = path.join(directory, name);
        const stat = yield* fs.stat(full);
        const transcribed = yield* fs.exists(sidecarPathFor(full));
        return { path: full, size: Number(stat.size), transcribed };
      })
    );

    yield* emitNdjson(rows);
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

// ---------------------------------------------------------------------------
// footage transcribe
// ---------------------------------------------------------------------------

/**
 * What `footage transcribe` runs inside: enough to write the Job row and follow
 * it. The work itself — ffmpeg and Whisper — is the Sidecar's
 * (`sidecar/kinds/transcribe-footage.ts`), so none of it is built here. Only reached when no JobOperationsService is provided already,
 * which is what lets a test hand it one on its own database.
 */
const footageJobLayer = Layer.mergeAll(
  JobOperationsService.Default,
  NodeContext.layer
).pipe(
  Layer.provideMerge(
    DrizzleService.Default.pipe(Layer.provide(GitWorktreeProbeLive))
  )
);

const noWaitOption = Options.boolean("no-wait").pipe(
  Options.withDescription(
    "enqueue the transcription Job and print its id, without waiting for it"
  )
);

/**
 * The file a typed path names: as typed when it exists, otherwise — for a
 * Clip's root-relative `videoFilename` (`raw-footage/take.mkv`) — the first
 * Storage Root that has it. Unchanged when neither finds it, so the "no such
 * footage file" names what was typed.
 */
const footageOnDisk = (typed: string): string => {
  if (existsSync(typed) || path.isAbsolute(typed)) return typed;
  try {
    return findStoragePathSync(typed, readStorageRootsSync()) ?? typed;
  } catch {
    // No STORAGE_ROOTS: only a path as typed can be found.
    return typed;
  }
};

const transcribeCmd = Command.make(
  "transcribe",
  { path: pathArg, noWait: noWaitOption },
  ({ path: typedPath, noWait }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
      const fs = yield* FileSystem.FileSystem;
      const givenPath = footageOnDisk(typedPath);

      if (!(yield* fs.exists(givenPath))) {
        return yield* parseError(
          `no such footage file: ${givenPath}`,
          "footage"
        );
      }
      // The Sidecar runs in its own directory: it is handed the absolute path.
      const sourcePath = path.resolve(givenPath);

      const run = Effect.gen(function* () {
        // The one way in: a `transcribe-footage` Job, which joins a live one
        // for the same file rather than paying Whisper twice.
        const job = yield* enqueueJob({
          id: null,
          kind: TRANSCRIBE_FOOTAGE_JOB_KIND,
          title: `Transcribe ${path.basename(sourcePath)}`,
          params: { path: sourcePath },
          dependsOn: null,
          subject: { type: "footage", id: sourcePath },
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
            path: sourcePath,
            sidecar: sidecarPathFor(sourcePath),
            log: `.data/logs/jobs/${job.id}.jsonl`,
          });
        }

        const out = yield* CliOutput;
        const summary = yield* waitForFootageTranscription({
          jobId: job.id,
          path: sourcePath,
          pollMs: 1_000,
          onWaiting: (line) => out.stderr(JSON.stringify(line) + "\n"),
        });
        yield* emitObject({ ...summary });
      });

      // A JobOperationsService already provided (a test's) is used as is;
      // otherwise loadRepoEnv runs BEFORE footageJobLayer is built, because
      // DrizzleService reads DATABASE_URL from process.env.
      const provided = yield* Effect.serviceOption(JobOperationsService);
      return yield* Option.match(provided, {
        onSome: (ops) =>
          run.pipe(Effect.provideService(JobOperationsService, ops)),
        onNone: () =>
          Effect.sync(() => loadRepoEnv()).pipe(
            Effect.zipRight(
              run.pipe(
                Effect.provide(footageJobLayer),
                Effect.withConfigProvider(ConfigProvider.fromEnv())
              )
            )
          ),
      });
    })
).pipe(Command.withDescription(detail(TRANSCRIBE_HELP)));

// ---------------------------------------------------------------------------
// footage transcript
// ---------------------------------------------------------------------------

const transcriptCmd = Command.make(
  "transcript",
  { path: pathArg },
  ({ path: typedPath }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
      const sourcePath = footageOnDisk(typedPath);
      const sidecar = yield* readFootageTranscript(sourcePath);
      if (sidecar === null) {
        return yield* notFound("footage transcript", sourcePath);
      }
      yield* emitObject({
        path: sidecar.sourcePath,
        sourceHash: sidecar.sourceHash,
        transcribedAt: sidecar.transcribedAt,
        words: sidecar.words,
        segments: sidecar.segments,
      });
    })
).pipe(Command.withDescription(detail(TRANSCRIPT_HELP)));

export const footageCommand = Command.make("footage").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([listCmd, transcribeCmd, transcriptCmd])
);
