import os from "node:os";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import {
  IMPORTED_FOOTAGE_FOLDER,
  IMPORT_PARTIAL_SUFFIX,
  rootRelativePath,
} from "@/packages/storage";
import {
  FootageImportError,
  asFootageImportError,
  chooseImportDestination,
  copyIntoImportedFootage,
} from "@/packages/storage/import";
import { readFootageTranscript } from "@/services/footage-cache";
import { notSixteenNine, probeFootage } from "@/services/footage-probe";
import { storageRootsConfig } from "@/services/storage-roots";
import { findYoutubeFootage } from "@/services/youtube-footage-import.server";
import { FOOTAGE_IMPORTED_EVENT } from "@/features/jobs/import-footage-job";
import { TRANSCRIBE_FOOTAGE_JOB_KIND } from "@/features/jobs/transcribe-footage-job";
import {
  youtubeFootageName,
  youtubeSourcePathFor,
  type YoutubeSource,
} from "@/features/imported-footage/youtube-footage";
import { defineJobKind, type JobContext } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { YOUTUBE_IMPORT_POLICY } from "../retry-policy";
import { downloadWithYtDlp, readTitleWithYtDlp } from "../yt-dlp";

type Params = { readonly url: string; readonly videoId: string };

/** A file-system failure, as the {@link FootageImportError} the Job ends with. */
const asImportError = <A, R>(
  effect: Effect.Effect<A, { readonly message: string }, R>
) =>
  effect.pipe(
    Effect.mapError((e) => new FootageImportError({ message: e.message }))
  );

/**
 * Where a video is downloaded before it is checked: outside every Storage
 * Root, so a refused or cut-off download never lands in
 * `raw-footage/imported/`. Emptied once a run ends, whichever way.
 */
const stagingDir = (videoId: string) =>
  path.join(os.tmpdir(), "cvm-youtube-import", videoId);

/** `dir`, made if it is not there, for one run's yt-dlp to write into. */
const freshDir = (dir: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    asImportError(fs.makeDirectory(dir, { recursive: true }))
  );

const clearStaging = (videoId: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    asImportError(
      fs.remove(stagingDir(videoId), { recursive: true, force: true })
    )
  );

/** Run `effect` in this video's staging dir, emptied whichever way it ends. */
const inStaging = <A, E, R>(
  videoId: string,
  effect: (dir: string) => Effect.Effect<A, E, R>
) =>
  freshDir(stagingDir(videoId)).pipe(
    Effect.zipRight(effect(stagingDir(videoId))),
    Effect.ensuring(
      clearStaging(videoId).pipe(
        Effect.catchAll((e) =>
          Effect.logWarning("import-youtube-footage: staging not cleared", {
            videoId,
            error: e.message,
          })
        )
      )
    )
  );

/** Download, refuse unless 16:9, then name it for the import. */
const downloadChecked = (params: Params, dir: string, ctx: JobContext) =>
  Effect.gen(function* () {
    yield* ctx.emit("progress", { stage: "downloading", percent: 0 });
    const downloaded = yield* downloadWithYtDlp({
      url: params.url,
      dir,
      onPercent: (percent) =>
        ctx.emit("progress", { stage: "downloading", percent }),
    });
    const probe = yield* probeFootage(downloaded.file).pipe(
      Effect.mapError(
        (e) =>
          new FootageImportError({
            message: `not imported: ${params.url}: ffprobe can't read the download (${e.message})`,
          })
      )
    );
    const why = notSixteenNine(probe);
    if (why !== null) {
      return yield* new FootageImportError({
        message: `not imported: ${params.url} ("${downloaded.title}"): ${why}. The download was deleted; nothing was placed in raw-footage/imported/.`,
      });
    }
    const named = path.join(
      dir,
      youtubeFootageName(downloaded.title, params.videoId)
    );
    const fs = yield* FileSystem.FileSystem;
    yield* asImportError(fs.rename(downloaded.file, named));
    return { file: named, title: downloaded.title };
  });

/** Keep where `footage` came from beside it, as `<file>.youtube.json`. */
const keepSource = (footage: string, params: Params, title: string) =>
  Effect.gen(function* () {
    const source: YoutubeSource = {
      url: params.url,
      title,
      videoId: params.videoId,
    };
    const fs = yield* FileSystem.FileSystem;
    yield* asImportError(
      fs.writeFileString(
        youtubeSourcePathFor(footage),
        `${JSON.stringify(source, null, 2)}\n`
      )
    );
  });

/** Copy the checked download in, with its source beside it. */
const placeDownload = (
  download: { readonly file: string; readonly title: string },
  params: Params,
  root: string,
  ctx: JobContext
) =>
  Effect.gen(function* () {
    const { destination } = yield* Effect.tryPromise({
      try: () =>
        chooseImportDestination(
          download.file,
          path.join(root, IMPORTED_FOOTAGE_FOLDER)
        ),
      catch: asFootageImportError,
    });
    yield* ctx.emit("progress", { stage: "copying", percent: 0 });
    const placed = yield* Effect.tryPromise({
      try: (signal) =>
        copyIntoImportedFootage({
          source: download.file,
          destination,
          root,
          signal,
        }),
      catch: asFootageImportError,
    });
    yield* keepSource(destination, params, download.title);
    return { destination, ...placed };
  });

/**
 * The file a run placed before it was cut off, given back its source if that
 * run never kept it: its title is read again, without downloading it.
 */
const reuseExisting = (
  existing: { readonly location: string; readonly path: string },
  params: Params
) =>
  Effect.gen(function* () {
    const destination = path.join(existing.location, existing.path);
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* asImportError(fs.exists(youtubeSourcePathFor(destination))))) {
      const title = yield* inStaging(params.videoId, (dir) =>
        readTitleWithYtDlp({ url: params.url, dir })
      );
      yield* keepSource(destination, params, title);
    }
    return destination;
  });

/** Remove a cut-off copy's partial of this video, if a run left one. */
const removePartials = (root: string, videoId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const folder = path.join(root, IMPORTED_FOOTAGE_FOLDER);
    if (!(yield* fs.exists(folder))) return;
    const partials = (yield* fs.readDirectory(folder)).filter((name) =>
      name.endsWith(`[${videoId}].mp4${IMPORT_PARTIAL_SUFFIX}`)
    );
    for (const name of partials) yield* fs.remove(path.join(folder, name));
  });

/**
 * **YouTube import** (#2545), enqueued by `cvm footage import <url>` or the
 * Imported Footage page's URL box: download one video with `yt-dlp` into the
 * OS temp dir, refuse it unless it is 16:9, then copy it in exactly as an
 * `import-footage` Job does (size and checksum checked, never overwriting),
 * named `<title> [<video id>].mp4`, with `<file>.youtube.json` beside it.
 * Then a `transcribe-footage` Job, unless its transcript is fresh. A video
 * id already imported is not downloaded again (only its title is read
 * again, if a cut-off run placed it without its `.youtube.json`). The
 * download is deleted whichever way the run ends. Not held during a take;
 * yt-dlp runs under `nice -n 19`.
 */
export const importYoutubeFootageJobKind = defineJobKind({
  ...YOUTUBE_IMPORT_POLICY,
  params: JOB_PARAMS["import-youtube-footage"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const roots = yield* storageRootsConfig;
      const existing = yield* findYoutubeFootage(roots, params.videoId);
      const placed = existing
        ? {
            destination: yield* reuseExisting(existing, params),
            copied: false,
            bytes: existing.size,
          }
        : yield* inStaging(params.videoId, (dir) =>
            downloadChecked(params, dir, ctx).pipe(
              Effect.flatMap((download) =>
                placeDownload(download, params, roots[0], ctx)
              )
            )
          );
      const relative =
        rootRelativePath(placed.destination, roots) ?? placed.destination;
      yield* Effect.logInfo("import-youtube-footage: done", {
        url: params.url,
        path: relative,
        copied: placed.copied,
      });
      yield* ctx.emit(FOOTAGE_IMPORTED_EVENT, {
        path: relative,
        copied: placed.copied,
        bytes: placed.bytes,
      });
      if ((yield* readFootageTranscript(placed.destination)) === null) {
        yield* ctx.enqueue({
          kind: TRANSCRIBE_FOOTAGE_JOB_KIND,
          title: `Transcribe ${path.basename(placed.destination)}`,
          params: { path: placed.destination },
          subject: { type: "footage", id: placed.destination },
          attemptsSpent: 0,
          dependsOn: null,
        });
      }
    }),
  // Never a download or a partial copy left behind by a Job that will not
  // run again.
  afterFinalFailure: (params) =>
    clearStaging(params.videoId).pipe(
      Effect.zipRight(storageRootsConfig),
      Effect.flatMap((roots) => removePartials(roots[0], params.videoId)),
      Effect.catchAll((e) =>
        Effect.logWarning("import-youtube-footage: cleanup after failure", {
          videoId: params.videoId,
          error: e.message,
        })
      )
    ),
});
