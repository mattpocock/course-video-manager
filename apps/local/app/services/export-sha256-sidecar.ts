import { Effect, Stream } from "effect";
import { FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import { DropboxContentHasher } from "./dropbox-content-hash";

/**
 * The digest of an Exported Video, cached on disk beside the export itself.
 *
 * A Publish that sends a Video digests it off the upload's own byte stream, so
 * the numbers below cost nothing to obtain. A Publish that finds the Video
 * already at its address sends nothing — and would otherwise have to read the
 * whole file back off disk purely to re-derive them. This sidecar is what that
 * second Publish reads instead.
 *
 * Caching is sound because an export is immutable: its name carries its Export
 * Hash, so any change to a Video's inputs produces a different file at a
 * different path rather than new bytes at this one. The cache can therefore
 * never describe stale content — only a file that no longer exists, which the
 * export garbage collector removes along with this sidecar.
 */
export type ExportDigest = {
  /** SHA256 of the file's bytes. Owed to the published manifest. */
  sha256: string;
  /** Dropbox's own block-based content hash, for the immutability check. */
  contentHash: string;
  /** Size in bytes, used to detect a sidecar that has fallen out of step. */
  bytes: number;
  /**
   * The export's measured duration in seconds, so the truncation check costs
   * one ffprobe the first time and nothing afterwards.
   *
   * `null` when this digest was taken from a byte stream that never passed
   * through ffprobe — an upload, or a file read back off disk. The duration is
   * then simply not known yet, and whoever needs it measures it.
   */
  durationInSeconds: number | null;
};

export const SIDECAR_SUFFIX = ".sha256";

/** `{courseId}-{exportHash}.mp4` → `{courseId}-{exportHash}.mp4.sha256` */
export const sidecarPath = (exportPath: string): string =>
  `${exportPath}${SIDECAR_SUFFIX}`;

const HEX_64 = /^[a-f0-9]{64}$/;

/**
 * Anything unparseable, incomplete, or disagreeing with the file on disk is
 * treated as an absent cache rather than an error. A torn write from a crashed
 * Publish therefore costs one re-read and heals itself, instead of failing the
 * Publish that finds it.
 */
const parseDigest = (
  raw: string,
  expectedBytes: number
): ExportDigest | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { sha256, contentHash, bytes, durationInSeconds } = parsed as Record<
    string,
    unknown
  >;
  if (typeof sha256 !== "string" || !HEX_64.test(sha256)) return null;
  if (typeof contentHash !== "string" || !HEX_64.test(contentHash)) return null;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) {
    return null;
  }
  // The one thing that could make a sidecar lie: bytes on disk that are not the
  // bytes it describes. Cheap to check, since the caller has already stat'd.
  if (bytes !== expectedBytes) return null;
  // A sidecar written before durations were recorded has no such field. It is
  // treated as absent rather than as an error, so it is simply replaced.
  if (durationInSeconds !== null) {
    if (typeof durationInSeconds !== "number") return null;
    if (!Number.isFinite(durationInSeconds) || durationInSeconds < 0) {
      return null;
    }
    return { sha256, contentHash, bytes, durationInSeconds };
  }

  return { sha256, contentHash, bytes, durationInSeconds: null };
};

/** The cached digest for an export, or `null` if there isn't a usable one. */
export const readExportDigest = (
  fs: FileSystem.FileSystem,
  exportPath: string,
  expectedBytes: number
): Effect.Effect<ExportDigest | null> =>
  fs.readFileString(sidecarPath(exportPath)).pipe(
    Effect.map((raw) => parseDigest(raw, expectedBytes)),
    Effect.catchAll(() => Effect.succeed(null))
  );

/** Read an Exported Video once and derive both digests from the one pass. */
const computeExportDigest = (
  fs: FileSystem.FileSystem,
  exportPath: string,
  durationInSeconds: number | null
): Effect.Effect<ExportDigest, never, never> =>
  Effect.gen(function* () {
    const sha256Hash = createHash("sha256");
    const contentHasher = new DropboxContentHasher();
    const bytes = yield* fs.stream(exportPath).pipe(
      Stream.runFold(0, (total, chunk) => {
        sha256Hash.update(chunk);
        contentHasher.update(chunk);
        return total + chunk.byteLength;
      })
    );
    return {
      sha256: sha256Hash.digest("hex"),
      bytes,
      contentHash: contentHasher.digest(),
      durationInSeconds,
    };
  }).pipe(Effect.orDie);

/**
 * The digest of the export on disk, taking it — and writing the sidecar that
 * caches it — if this machine does not already hold one. `null` when there is
 * nothing to digest: no file at that path, or a file that cannot be read.
 *
 * Sidecars used to be written only by an upload, which was sound while every
 * Publish uploaded everything. Once a Publish can COPY an unchanged Video
 * inside Dropbox instead, no upload happens — so a sidecar written at upload
 * time would never be written again, and the coverage that verification
 * depends on would freeze wherever it stood.
 *
 * Ensuring it at export time inverts that: every Exported Video carries its
 * digest from birth, so the immutability check is free and grows to cover
 * everything. "Every" includes the export the pool finds already on disk and
 * skips — that is precisely the old export whose sidecar is still missing, so
 * digesting only the freshly encoded ones would leave the backlog uncovered
 * for ever. The read is therefore conditional, not the write: a file that
 * already has a sound sidecar costs one stat.
 *
 * Keeping the answer is what lets a Publish decide by BYTES. A Video's Byte
 * Hash is the only thing that can say whether the file this machine holds is
 * the file Dropbox already has, and the sidecar is where that hash lives.
 * `null` therefore means "this machine cannot vouch for any bytes", never "the
 * bytes are different" — the caller falls back rather than concluding. A
 * caller with no use for the answer can simply discard it; best-effort
 * throughout, so a digest that cannot be taken or written costs the next
 * Publish a re-read and is never a reason to fail this one.
 *
 * `durationInSeconds` is what the caller has just measured, or `null` when it
 * has measured nothing. It is only ever written down, never compared: a
 * caller that holds no duration still gets the digest it asked for.
 */
export const ensureExportDigest = (
  fs: FileSystem.FileSystem,
  exportPath: string,
  durationInSeconds: number | null
): Effect.Effect<ExportDigest | null> =>
  Effect.gen(function* () {
    const size = Number((yield* fs.stat(exportPath)).size);
    const cached = yield* readExportDigest(fs, exportPath, size);
    if (cached) {
      // A sound sidecar that is only missing the duration is worth one small
      // rewrite; re-reading the whole file to learn a number the caller
      // already holds is not.
      if (cached.durationInSeconds !== null || durationInSeconds === null) {
        return cached;
      }
      const filled = { ...cached, durationInSeconds };
      yield* writeExportDigest(fs, exportPath, filled);
      return filled;
    }
    // A sidecar that is missing, torn, or disagrees with the file on disk is
    // an absent one. Replacing it costs one read, once.
    const digest = yield* computeExportDigest(
      fs,
      exportPath,
      durationInSeconds
    );
    yield* writeExportDigest(fs, exportPath, digest);
    return digest;
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

/**
 * Best-effort: a sidecar that cannot be written costs the next Publish a
 * re-read and is never a reason to fail this one.
 */
export const writeExportDigest = (
  fs: FileSystem.FileSystem,
  exportPath: string,
  digest: ExportDigest
): Effect.Effect<void> =>
  fs
    .writeFileString(sidecarPath(exportPath), JSON.stringify(digest))
    .pipe(Effect.ignore);

/**
 * The export's duration in seconds, measured at most once in its lifetime.
 *
 * A sidecar that already records a duration answers immediately. Anything else
 * — no sidecar, a torn one, or one written before durations were recorded —
 * costs one `measure`, and the answer is written down so the next Publish that
 * asks pays nothing. This is what lets the truncation check run on every visit
 * to an export, including the ones the export step finds already on disk.
 *
 * `measure` must already have collapsed its own failure to a number — an
 * export that cannot be probed is not sound, and this is not the place to
 * decide that. It stays generic in its CONTEXT alone, because the one measure
 * that matters shells out to ffprobe and so carries a CommandExecutor.
 */
export const ensureExportDuration = <R>(
  fs: FileSystem.FileSystem,
  exportPath: string,
  measure: Effect.Effect<number, never, R>
): Effect.Effect<number, never, R> =>
  Effect.gen(function* () {
    const cached = yield* ensureExportDigest(fs, exportPath, null);
    if (cached?.durationInSeconds != null) return cached.durationInSeconds;
    const measured = yield* measure;
    yield* ensureExportDigest(fs, exportPath, measured);
    return measured;
  });

/**
 * The duration this machine has already recorded for an export, or `null` when
 * it has recorded none — no file, no sidecar, or a sidecar that disagrees with
 * the file on disk.
 *
 * Cheap on purpose: a stat and a small read, never a pass over the export
 * itself. It answers "do I already know this export is sound?", which is a
 * question a walk over a whole Course has to be able to ask.
 */
export const readExportDurationInSeconds = (
  fs: FileSystem.FileSystem,
  exportPath: string
): Effect.Effect<number | null> =>
  Effect.gen(function* () {
    const size = Number((yield* fs.stat(exportPath)).size);
    const digest = yield* readExportDigest(fs, exportPath, size);
    return digest?.durationInSeconds ?? null;
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));
