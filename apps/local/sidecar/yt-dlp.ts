import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
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
 */

export const YT_DLP_MISSING =
  "yt-dlp is not on the Sidecar's PATH, so nothing was downloaded. Install it (Linux, not Windows): `mkdir -p ~/.local/bin && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp && chmod a+rx ~/.local/bin/yt-dlp`, then restart the Sidecar (`pnpm dev`)";

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

/** yt-dlp's lines and how it ended; killed if the Job is interrupted. */
const runYtDlp = (args: readonly string[]) =>
  Stream.async<Output>((emit) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
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
      void emit.single({ type: "exit", code });
      void emit.end();
    });
    return Effect.sync(() => {
      if (child.exitCode === null) child.kill("SIGTERM");
    });
  });

/** What yt-dlp's info JSON says of the video it downloaded. */
interface YtDlpInfo {
  readonly title?: unknown;
}

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
    const base = path.join(opts.dir, "download");
    const tail: string[] = [];
    let missing = false;
    let code: number | null = null;
    let last = -1;
    yield* runYtDlp(ytDlpArgs(opts.url, base)).pipe(
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
        return opts.onPercent(percent);
      })
    );
    if (missing)
      return yield* new FootageImportError({ message: YT_DLP_MISSING });
    const file = `${base}.mp4`;
    if (code !== 0 || !fs.existsSync(file)) {
      return yield* new FootageImportError({
        message: `yt-dlp could not download ${opts.url} (exit ${code}): ${tail.join(" / ") || "no output"}`,
      });
    }
    const info = yield* Effect.try({
      try: () =>
        JSON.parse(fs.readFileSync(`${base}.info.json`, "utf8")) as YtDlpInfo,
      catch: () =>
        new FootageImportError({
          message: `yt-dlp downloaded ${opts.url} but wrote no info JSON, so its title is unknown`,
        }),
    });
    return {
      file,
      title: typeof info.title === "string" ? info.title : "",
    };
  });
