import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { FileSystem } from "@effect/platform";
import { Effect, Stream } from "effect";
import { FootageImportError } from "@/packages/storage/import";

/**
 * `yt-dlp`, as the `import-youtube-footage` Job runs it (#2545).
 *
 * PROVISIONED LIKE THE SIDECAR'S OTHER LINUX TOOLS: `ffmpeg` and `ffprobe` are
 * whatever is on the Sidecar's PATH, and so is `yt-dlp`. CVM installs none
 * of them. When it is missing the Job fails with {@link YT_DLP_MISSING},
 * which names the install.
 *
 * One format, no fallbacks: the best video up to 1080p and the best audio,
 * merged to MP4 by the ffmpeg on the PATH. One video, never a playlist.
 *
 * Imports are not held during a take, so yt-dlp (and the ffmpeg it merges
 * with, which inherits its priority) runs under `nice -n 19`, below the
 * capture (CODING_STANDARDS, "Work that runs during a take").
 */

export const YT_DLP_MISSING =
  "yt-dlp is not on the Sidecar's PATH, so nothing was downloaded. Install it (Linux, not Windows): `mkdir -p ~/.local/bin && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp && chmod a+rx ~/.local/bin/yt-dlp`, then restart the Sidecar (`pnpm dev`)";

/** What yt-dlp is run with to write only `<base>.info.json`: no media. */
export const ytDlpInfoArgs = (url: string, base: string): string[] => [
  "--no-playlist",
  "--skip-download",
  "--write-info-json",
  "--output",
  `${base}.%(ext)s`,
  url,
];

/** The prefix of the progress lines CVM asks yt-dlp to print. */
const PROGRESS = "cvm-progress";

/** What yt-dlp is run with, writing `<base>.mp4` and `<base>.info.json`. */
export const ytDlpArgs = (url: string, base: string): string[] => [
  "--no-playlist",
  "--newline",
  "--format",
  "bv*[height<=1080]+ba",
  "--merge-output-format",
  "mp4",
  "--write-info-json",
  "--progress-template",
  `download:${PROGRESS} %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s`,
  "--output",
  `${base}.%(ext)s`,
  url,
];

/**
 * The percent (0-100) one of CVM's progress lines says, or null for any
 * other line, or one that does not know the total yet. The video and the
 * audio are downloaded one after the other, so it runs 0-100 twice.
 */
export const ytDlpPercent = (line: string): number | null => {
  const [tag, done, total] = line.trim().split(/\s+/);
  if (tag !== PROGRESS) return null;
  const ratio = Number(done) / Number(total);
  return Number.isFinite(ratio) ? Math.min(100, Math.floor(ratio * 100)) : null;
};

type Output =
  | { readonly type: "line"; readonly text: string }
  | { readonly type: "missing" }
  | { readonly type: "exit"; readonly code: number | null };

/** What `nice` exits with when the command it was to run is not found. */
const NOT_FOUND_EXIT = 127;

/** yt-dlp's lines and how it ended; killed if the Job is interrupted. */
const runYtDlp = (args: readonly string[]) =>
  Stream.async<Output>((emit) => {
    const child = spawn("nice", ["-n", "19", "yt-dlp", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = (text: string) => {
      if (text.trim()) void emit.single({ type: "line", text });
    };
    readline.createInterface({ input: child.stdout }).on("line", line);
    readline.createInterface({ input: child.stderr }).on("line", line);
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") void emit.single({ type: "missing" });
      else line(String(error));
      void emit.end();
    });
    child.on("close", (code) => {
      void emit.single(
        code === NOT_FOUND_EXIT ? { type: "missing" } : { type: "exit", code }
      );
      void emit.end();
    });
    return Effect.sync(() => {
      if (child.exitCode === null) child.kill("SIGTERM");
    });
  });

/**
 * Run yt-dlp with `args` to its end, reporting each new percent. Fails with
 * a {@link FootageImportError} when it is missing or exits non-zero (its
 * last lines say why).
 */
const runToEnd = (
  url: string,
  args: readonly string[],
  onPercent: (percent: number) => Effect.Effect<void>
) =>
  Effect.gen(function* () {
    const tail: string[] = [];
    let missing = false;
    let code: number | null = null;
    let last = -1;
    yield* runYtDlp(args).pipe(
      Stream.runForEach((out) => {
        if (out.type === "missing") missing = true;
        if (out.type === "exit") code = out.code;
        if (out.type !== "line") return Effect.void;
        const percent = ytDlpPercent(out.text);
        if (percent === null) {
          tail.push(out.text);
          if (tail.length > 10) tail.shift();
          return Effect.void;
        }
        if (percent === last) return Effect.void;
        last = percent;
        return onPercent(percent);
      })
    );
    if (missing)
      return yield* new FootageImportError({ message: YT_DLP_MISSING });
    if (code !== 0) {
      return yield* new FootageImportError({
        message: `yt-dlp could not download ${url} (exit ${code}): ${tail.join(" / ") || "no output"}`,
      });
    }
  });

/** The title in `<base>.info.json`, as yt-dlp wrote it. */
const readTitle = (url: string, base: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.readFileString(`${base}.info.json`).pipe(
      Effect.flatMap((text) =>
        Effect.try(() => JSON.parse(text) as { readonly title?: unknown })
      ),
      Effect.mapError(
        () =>
          new FootageImportError({
            message: `yt-dlp read ${url} but wrote no info JSON, so its title is unknown`,
          })
      )
    );
    return typeof info.title === "string" ? info.title : "";
  });

/**
 * Download `url` into `dir` as `download.mp4`, reporting each new percent.
 * Fails with a {@link FootageImportError}: yt-dlp missing, or ending without
 * a file (its last lines say why).
 */
export const downloadWithYtDlp = (opts: {
  readonly url: string;
  readonly dir: string;
  readonly onPercent: (percent: number) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const base = path.join(opts.dir, "download");
    yield* runToEnd(opts.url, ytDlpArgs(opts.url, base), opts.onPercent);
    const file = `${base}.mp4`;
    const there = yield* fs
      .exists(file)
      .pipe(
        Effect.mapError(
          (e) => new FootageImportError({ message: `${file}: ${e.message}` })
        )
      );
    if (!there) {
      return yield* new FootageImportError({
        message: `yt-dlp ended without downloading ${opts.url}`,
      });
    }
    return { file, title: yield* readTitle(opts.url, base) };
  });

/**
 * The title of the video at `url`, read by yt-dlp into `dir` without
 * downloading it: for a file placed by a run cut off before it kept its
 * title.
 */
export const readTitleWithYtDlp = (opts: {
  readonly url: string;
  readonly dir: string;
}) =>
  Effect.gen(function* () {
    const base = path.join(opts.dir, "info");
    yield* runToEnd(opts.url, ytDlpInfoArgs(opts.url, base), () => Effect.void);
    return yield* readTitle(opts.url, base);
  });
