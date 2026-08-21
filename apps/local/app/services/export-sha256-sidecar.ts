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

  const { sha256, contentHash, bytes } = parsed as Record<string, unknown>;
  if (typeof sha256 !== "string" || !HEX_64.test(sha256)) return null;
  if (typeof contentHash !== "string" || !HEX_64.test(contentHash)) return null;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) {
    return null;
  }
  // The one thing that could make a sidecar lie: bytes on disk that are not the
  // bytes it describes. Cheap to check, since the caller has already stat'd.
  if (bytes !== expectedBytes) return null;

  return { sha256, contentHash, bytes };
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
export const computeExportDigest = (
  fs: FileSystem.FileSystem,
  exportPath: string
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
    };
  }).pipe(Effect.orDie);

/**
 * Give an export a sidecar if it does not already have a usable one.
 *
 * Sidecars used to be written only by an upload, which was sound while every
 * Publish uploaded everything. Once a Publish can COPY an unchanged Video
 * inside Dropbox instead, no upload happens — so a sidecar written at upload
 * time would never be written again, and the coverage that verification
 * depends on would freeze wherever it stood.
 *
 * Writing at export time inverts that: every Exported Video carries its digest
 * from birth, so the immutability check is free and grows to cover everything.
 * "Every" includes the export the pool finds already on disk and skips — that
 * is precisely the old export whose sidecar is still missing, so digesting
 * only the freshly encoded ones would leave the backlog uncovered for ever.
 *
 * The read is therefore conditional, not the write: a file that already has a
 * sound sidecar costs one stat. Best-effort throughout — a digest that cannot
 * be taken or written costs the next Publish a re-read and is never a reason
 * to fail this one.
 */
export const ensureExportDigest = (
  fs: FileSystem.FileSystem,
  exportPath: string
): Effect.Effect<void> => loadExportDigest(fs, exportPath).pipe(Effect.asVoid);

/**
 * The digest of the export on disk, or `null` if this machine has no usable
 * one — no file at that path, or a file it cannot read.
 *
 * This is `ensureExportDigest` with its answer kept rather than thrown away,
 * and it is what lets a Publish decide by BYTES. A Video's Byte Hash is the
 * only thing that can say whether the file this machine holds is the file
 * Dropbox already has, and the sidecar is where that hash lives.
 *
 * `null` therefore means "this machine cannot vouch for any bytes", never
 * "the bytes are different" — the caller falls back rather than concluding.
 */
export const loadExportDigest = (
  fs: FileSystem.FileSystem,
  exportPath: string
): Effect.Effect<ExportDigest | null> =>
  Effect.gen(function* () {
    const size = Number((yield* fs.stat(exportPath)).size);
    const cached = yield* readExportDigest(fs, exportPath, size);
    if (cached) return cached;
    // A sidecar that is missing, torn, or disagrees with the file on disk is
    // an absent one. Replacing it costs one read, once.
    const digest = yield* computeExportDigest(fs, exportPath);
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
