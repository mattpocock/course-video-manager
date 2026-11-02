import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import {
  Config,
  ConfigProvider,
  Effect,
  Logger,
  LogLevel,
  Option,
} from "effect";
import { homedir } from "node:os";
import path from "node:path";
import { isFootageFileName } from "@/packages/storage";
import {
  asFootageImportError,
  findImportedFootage,
} from "@/packages/storage/import";
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
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { FILE_NAMES } from "recorder-service/capture-args";
import { footageOnDisk } from "./footage-on-disk";
import { importCmd } from "./footage-import";
import { searchCmd } from "./footage-search";
import { frameCmd } from "./footage-frame";
import {
  footageStorageRoots,
  requireLocalFootage,
  withFootageJobs,
} from "./footage-jobs";
import { waitForFootageTranscription } from "./footage-transcribe-wait";
import {
  HELP,
  LIST_HELP,
  TRANSCRIBE_HELP,
  TRANSCRIPT_HELP,
} from "./footage.help";

const dirOption = Options.text("dir").pipe(
  Options.withDescription(
    "Directory to list (default: OBS_RECORDING_DIR, else ~/Videos)."
  ),
  Options.optional
);

const importedOption = Options.boolean("imported").pipe(
  Options.withDescription(
    "List Imported Footage on every Storage Root instead (root-relative paths)."
  )
);

const pathArg = Args.text({ name: "path" });

// ---------------------------------------------------------------------------
// footage list
// ---------------------------------------------------------------------------

/** `footage list --imported`: the walk over every root's raw-footage/imported/. */
const listImported = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const roots = yield* footageStorageRoots;
  const files = yield* Effect.tryPromise({
    try: () => findImportedFootage(roots),
    catch: asFootageImportError,
  });
  const rows = yield* Effect.forEach(files, (file) =>
    fs.exists(sidecarPathFor(path.join(file.location, file.path))).pipe(
      Effect.map((transcribed) => ({
        path: file.path,
        size: file.size,
        transcribed,
      }))
    )
  );
  yield* emitNdjson(rows);
});

const listCmd = Command.make(
  "list",
  { dir: dirOption, imported: importedOption },
  ({ dir, imported }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
      if (imported) {
        if (Option.isSome(dir)) {
          return yield* parseError(
            "pass --dir or --imported, not both",
            "footage"
          );
        }
        return yield* listImported;
      }
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

      const files = entries.filter((name) => isFootageFileName(name));
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

      const rows = yield* Effect.forEach(
        [...files, ...micFiles].sort(),
        (name) =>
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

const noWaitOption = Options.boolean("no-wait").pipe(
  Options.withDescription(
    "enqueue the transcription Job and print its id, without waiting for it"
  )
);

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

      return yield* withFootageJobs(run);
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
  Command.withSubcommands([
    listCmd,
    importCmd,
    searchCmd,
    transcribeCmd,
    transcriptCmd,
    frameCmd,
  ])
);
