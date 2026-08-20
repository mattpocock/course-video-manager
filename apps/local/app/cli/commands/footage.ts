import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Config, ConfigProvider, Effect, Option } from "effect";
import { homedir } from "node:os";
import path from "node:path";
import { VideoProcessingService } from "@/services/video-processing-service";
import {
  computeFileContentHash,
  readFootageTranscript,
  sidecarPathFor,
  writeFootageTranscript,
} from "@/services/footage-cache";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
} from "@/cli/helpers";
import { loadRepoEnv } from "@/cli/env";
import { NEEDS_FOOTAGE_ON_DISK, requireLocalMachine } from "@/cli/local-only";
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

    // Load the repo .env so OBS_RECORDING_DIR resolves the same way it does for
    // the recorder (see getLatestOBSVideoClips), then read it via Config.
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

    const files = entries
      .filter((name) => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort();

    const rows = yield* Effect.forEach(files, (name) =>
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
 * The heavy service graph `footage transcribe` runs its Whisper/ffmpeg work
 * inside, built LOCALLY here rather than merged into the shared cliRuntime —
 * exactly like `course publish` (see course-publish.ts): VideoProcessingService
 * reads OPENAI_API_KEY at BUILD time, and no read command should have to satisfy
 * that key. It is only reached on the branch below where the service was not
 * already provided — which is what lets a test inject a fake VideoProcessingService
 * and never touch real ffmpeg or OpenAI.
 */
const footageProcessingLayer = VideoProcessingService.Default;

const transcribeCmd = Command.make(
  "transcribe",
  { path: pathArg },
  ({ path: sourcePath }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
      const fs = yield* FileSystem.FileSystem;

      if (!(yield* fs.exists(sourcePath))) {
        return yield* parseError(
          `no such footage file: ${sourcePath}`,
          "footage"
        );
      }

      // Use an ambiently-provided VideoProcessingService if there is one (a test
      // fake); otherwise build the real one here, loading the repo .env first so
      // OPENAI_API_KEY is present at the layer's build time.
      const provided = yield* Effect.serviceOption(VideoProcessingService);
      const transcript = yield* Option.match(provided, {
        onSome: (svc) => svc.transcribeFootageFile(sourcePath),
        onNone: () =>
          Effect.gen(function* () {
            yield* Effect.sync(() => loadRepoEnv());
            const svc = yield* VideoProcessingService;
            return yield* svc.transcribeFootageFile(sourcePath);
          }).pipe(
            Effect.provide(footageProcessingLayer),
            Effect.withConfigProvider(ConfigProvider.fromEnv())
          ),
      });

      const sourceHash = yield* computeFileContentHash(sourcePath);
      const sidecar = yield* writeFootageTranscript({
        sourcePath,
        sourceHash,
        transcript,
      });

      yield* emitObject({
        path: sidecar.sourcePath,
        sidecar: sidecarPathFor(sourcePath),
        sourceHash: sidecar.sourceHash,
        transcribedAt: sidecar.transcribedAt,
        words: sidecar.words.length,
        segments: sidecar.segments.length,
      });
    })
).pipe(Command.withDescription(detail(TRANSCRIBE_HELP)));

// ---------------------------------------------------------------------------
// footage transcript
// ---------------------------------------------------------------------------

const transcriptCmd = Command.make(
  "transcript",
  { path: pathArg },
  ({ path: sourcePath }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
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
