import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect, Logger, LogLevel } from "effect";
import type { StorageRoots } from "@/packages/storage";
import {
  asFootageImportError,
  findImportedFootage,
} from "@/packages/storage/import";
import { readFootageTranscript } from "@/services/footage-cache";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { storageRootsConfig } from "@/services/storage-roots";
import {
  IMPORT_YOUTUBE_FOOTAGE_JOB_KIND,
  YOUTUBE_SUBJECT_TYPE,
} from "@/features/jobs/import-youtube-footage-job";
import { TRANSCRIBE_FOOTAGE_JOB_KIND } from "@/features/jobs/transcribe-footage-job";
import {
  isYoutubeFootageOf,
  youtubeSourcePathFor,
  youtubeVideoIdOf,
  youtubeWatchUrl,
  type YoutubeSource,
} from "@/features/imported-footage/youtube-footage";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";

/**
 * Starting an import from a YouTube URL (#2545), the one path
 * `cvm footage import <url>` and the Imported Footage page's URL box share.
 * The download itself is the `import-youtube-footage` Job.
 */

/** What was pasted is not the URL of one YouTube video. */
export class NotYoutubeVideoUrlError extends Data.TaggedError(
  "NotYoutubeVideoUrlError"
)<{ readonly message: string }> {}

/** The Imported Footage file already downloaded for this video id, if any. */
export const findYoutubeFootage = (roots: StorageRoots, videoId: string) =>
  Effect.tryPromise({
    try: () => findImportedFootage(roots),
    catch: asFootageImportError,
  }).pipe(
    Effect.map(
      (files) => files.find((f) => isYoutubeFootageOf(f.path, videoId)) ?? null
    )
  );

/**
 * Where a YouTube import came from (`<file>.youtube.json`), or null for a
 * file that was not downloaded from YouTube, or whose companion is unreadable.
 */
export const readYoutubeSource = (absolute: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(youtubeSourcePathFor(absolute));
    const json = yield* Effect.try(
      () => JSON.parse(text) as Partial<YoutubeSource>
    );
    return typeof json.url === "string" && typeof json.title === "string"
      ? { url: json.url, title: json.title }
      : null;
  }).pipe(Effect.orElseSucceed(() => null));

/** A transcription of `absolute`, unless its transcript is fresh. */
export const enqueueFootageTranscription = (absolute: string) =>
  Effect.gen(function* () {
    if ((yield* readFootageTranscript(absolute)) !== null) return null;
    return yield* enqueueJob({
      id: null,
      kind: TRANSCRIBE_FOOTAGE_JOB_KIND,
      title: `Transcribe ${path.basename(absolute)}`,
      params: { path: absolute },
      dependsOn: null,
      subject: { type: "footage", id: absolute },
      attemptsSpent: 0,
      registry: JOB_KIND_SPECS,
    });
  });

/**
 * Queue the download of `url`, or, when that video id is already Imported
 * Footage, reuse the file (queueing its transcription if it has none).
 * `path` is root-relative, and set only when the file is already there.
 */
export const startYoutubeImport = Effect.fn("startYoutubeImport")(function* (
  url: string
) {
  const videoId = youtubeVideoIdOf(url.trim());
  if (videoId === null) {
    return yield* new NotYoutubeVideoUrlError({
      message: `not the URL of a YouTube video: ${url}`,
    });
  }
  const roots = yield* storageRootsConfig;
  const existing = yield* findYoutubeFootage(roots, videoId);
  const started = existing
    ? {
        videoId,
        jobId: null,
        transcribeJobId:
          (yield* enqueueFootageTranscription(
            path.join(existing.location, existing.path)
          ))?.id ?? null,
        path: existing.path,
      }
    : {
        videoId,
        jobId: (yield* enqueueJob({
          id: null,
          kind: IMPORT_YOUTUBE_FOOTAGE_JOB_KIND,
          title: `Import YouTube video ${videoId}`,
          params: { url: youtubeWatchUrl(videoId), videoId },
          dependsOn: null,
          subject: { type: YOUTUBE_SUBJECT_TYPE, id: videoId },
          attemptsSpent: 0,
          registry: JOB_KIND_SPECS,
        })).id,
        transcribeJobId: null,
        path: null,
      };
  // Best effort, and silent: a Sidecar that is down finds the Job when it
  // starts.
  yield* nudgeSidecar().pipe(Logger.withMinimumLogLevel(LogLevel.None));
  return started;
});
