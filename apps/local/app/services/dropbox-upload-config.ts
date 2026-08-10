import { Config } from "effect";

/**
 * Tunables for the Dropbox leg of a Publish, alongside the existing
 * FINISHED_VIDEOS_DIRECTORY / DROPBOX_REMOTE_PATH settings.
 *
 * The resident memory ceiling of a Publish is roughly
 * `DROPBOX_UPLOAD_CONCURRENCY × DROPBOX_UPLOAD_CHUNK_SIZE_MB`, since each
 * in-flight upload session holds one chunk in memory at a time.
 */

/**
 * How many Videos stream to Dropbox at once. Deliberately conservative:
 * Dropbox takes a per-namespace write lock, and too many parallel writers
 * trade throughput for rate-limit responses.
 */
export const DEFAULT_UPLOAD_CONCURRENCY = 4;

/** Dropbox recommends upload-session chunks in multiples of 4 MB. */
export const DEFAULT_UPLOAD_CHUNK_SIZE_MB = 16;

export const uploadConcurrency = Config.integer(
  "DROPBOX_UPLOAD_CONCURRENCY"
).pipe(
  Config.withDefault(DEFAULT_UPLOAD_CONCURRENCY),
  Config.validate({
    message: "DROPBOX_UPLOAD_CONCURRENCY must be at least 1",
    validation: (value) => value >= 1,
  })
);

export const uploadChunkSizeBytes = Config.integer(
  "DROPBOX_UPLOAD_CHUNK_SIZE_MB"
).pipe(
  Config.withDefault(DEFAULT_UPLOAD_CHUNK_SIZE_MB),
  Config.validate({
    message: "DROPBOX_UPLOAD_CHUNK_SIZE_MB must be at least 4",
    validation: (value) => value >= 4,
  }),
  Config.map((megabytes) => megabytes * 1024 * 1024)
);
