import { Config } from "effect";

/**
 * Tunables for the Dropbox leg of a Publish, alongside the existing
 * STORAGE_ROOTS / DROPBOX_REMOTE_PATH settings.
 *
 * The resident memory ceiling of a Publish is roughly
 * `DROPBOX_UPLOAD_CONCURRENCY × DROPBOX_UPLOAD_CHUNK_SIZE_MB`, since each
 * in-flight upload session holds one chunk in memory at a time: 8 × 64 MB =
 * 512 MB at the defaults. A Video at or under the 150 MB simple-upload limit
 * is sent in one request and held whole, so the true peak is up to
 * `DROPBOX_UPLOAD_CONCURRENCY × 150 MB` while several of those are in flight.
 */

/**
 * How many Videos stream to Dropbox at once. Each upload session sends its
 * chunks one after another, so this is the only parallelism a Publish has.
 * Dropbox takes a per-namespace write lock when each one commits, and too many
 * parallel writers trade throughput for rate-limit responses — which
 * `dropboxFetch` backs off from and retries.
 */
export const DEFAULT_UPLOAD_CONCURRENCY = 8;

/**
 * Bytes per upload-session request. Bigger chunks mean fewer round trips per
 * Video. Dropbox wants a multiple of 4 MB and refuses a request over 150 MB,
 * so the largest chunk allowed is 148 MB.
 */
export const DEFAULT_UPLOAD_CHUNK_SIZE_MB = 64;

/** Dropbox's ceiling on one upload request's body. */
const MAX_REQUEST_MB = 150;

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
    message: `DROPBOX_UPLOAD_CHUNK_SIZE_MB must be a multiple of 4, from 4 to ${MAX_REQUEST_MB}`,
    validation: (value) =>
      value >= 4 && value % 4 === 0 && value <= MAX_REQUEST_MB,
  }),
  Config.map((megabytes) => megabytes * 1024 * 1024)
);
