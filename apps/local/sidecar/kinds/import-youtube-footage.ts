import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { downloadWithYtDlp } from "../yt-dlp";

/**
 * Where a video is downloaded before it is checked: outside every Storage
 * Root, so a refused or cut-off download never lands in
 * `raw-footage/imported/`. Emptied once a run ends, whichever way.
 */
const stagingDir = (videoId: string) =>
  path.join(os.tmpdir(), "cvm-youtube-import", videoId);

const clearStaging = (videoId: string) =>
  Effect.sync(() =>
    fs.rmSync(stagingDir(videoId), { recursive: true, force: true })
  );

/** Download, refuse unless 16:9, then name it for the import. */
const downloadChecked = (
  params: { readonly url: string; readonly videoId: string },
  ctx: JobContext
) =>
  Effect.gen(function* () {
    const dir = stagingDir(params.videoId);
    yield* Effect.sync(() => fs.mkdirSync(dir, { recursive: true }));
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
    yield* Effect.sync(() => fs.renameSync(downloaded.file, named));
    return { file: named, title: downloaded.title };
  });

/** Copy the checked download in, with its source beside it. */
const placeDownload = (
  download: { readonly file: string; readonly title: string },
  params: { readonly url: string; readonly videoId: string },
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
    const source: YoutubeSource = {
      url: params.url,
      title: download.title,
      videoId: params.videoId,
    };
    yield* Effect.sync(() =>
      fs.writeFileSync(
        youtubeSourcePathFor(destination),
        `${JSON.stringify(source, null, 2)}\n`
      )
    );
    return { destination, ...placed };
  });

/** Remove a cut-off copy's partial of this video, if a run left one. */
const removePartials = (root: string, videoId: string) =>
  Effect.sync(() => {
    const folder = path.join(root, IMPORTED_FOOTAGE_FOLDER);
    const partials = fs.existsSync(folder)
      ? fs
          .readdirSync(folder)
          .filter((name) =>
            name.endsWith(`[${videoId}].mp4${IMPORT_PARTIAL_SUFFIX}`)
          )
      : [];
    for (const name of partials) fs.rmSync(path.join(folder, name));
  });

/**
 * **YouTube import** (#2545), enqueued by `cvm footage import <url>` or the
 * Imported Footage page's URL box: download one video with `yt-dlp` into the
 * OS temp dir, refuse it unless it is 16:9, then copy it in exactly as an
 * `import-footage` Job does (size and checksum checked, never overwriting),
 * named `<title> [<video id>].mp4`, with `<file>.youtube.json` beside it.
 * Then a `transcribe-footage` Job, unless its transcript is fresh. A video
 * id already imported is not downloaded again. The download is deleted
 * whichever way the run ends. Not held during a take.
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
            destination: path.join(existing.location, existing.path),
            copied: false,
            bytes: existing.size,
          }
        : yield* downloadChecked(params, ctx).pipe(
            Effect.flatMap((download) =>
              placeDownload(download, params, roots[0], ctx)
            ),
            Effect.ensuring(clearStaging(params.videoId))
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
      Effect.ignore
    ),
});
