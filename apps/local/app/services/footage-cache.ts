import { Effect, Option, Stream } from "effect";
import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { createHash } from "node:crypto";
import path from "node:path";
import type { FootageTranscript } from "./footage-chunking";

/**
 * The on-disk cache for a **Footage** transcript (see GLOSSARY.md "Footage").
 *
 * FOOTAGE HAS NO DATABASE ROW. Its identity is a filesystem path, and its
 * transcript is cached in a SIDECAR file next to the source — the same
 * "filesystem is the state" convention as a Video File. The sidecar for
 * `/videos/rec.mkv` is `/videos/rec.mkv.transcript.json`.
 *
 * The cache is KEYED BY A CONTENT HASH of the source file, stored inside the
 * sidecar. If the source is re-recorded or replaced, its hash changes and the
 * cached transcript no longer matches — `readFootageTranscript` reports the
 * cache as absent (stale), so `footage transcribe` re-transcribes rather than
 * silently serving the old file's words, and `footage transcript` reports
 * not-found rather than a stale transcript.
 *
 * Hashing a many-GB file on every read is too slow for a search, so the
 * sidecar also records the source's SIZE and MTIME at the moment it was
 * hashed (`sourceStamp`). While both still match, the hash is trusted
 * without reading the bytes again, the same trust a Storage move gives a
 * copy it placed (#2179). A file whose stamp differs, or a sidecar with no
 * stamp, is hashed in full as before.
 */

const SIDECAR_SUFFIX = ".transcript.json";
const SIDECAR_VERSION = 1 as const;

export interface FootageSidecar {
  readonly version: typeof SIDECAR_VERSION;
  /** The source file this transcript was produced from (absolute). */
  readonly sourcePath: string;
  /** SHA-256 of the source file's contents when it was transcribed. */
  readonly sourceHash: string;
  /** The source's size and mtime when it was hashed; absent before #2537. */
  readonly sourceStamp?: FootageStamp;
  /** When the transcript was produced (ISO 8601). */
  readonly transcribedAt: string;
  readonly words: FootageTranscript["words"];
  readonly segments: FootageTranscript["segments"];
}

/** A file's size and mtime (ms): what says it is unchanged since hashed. */
export interface FootageStamp {
  readonly size: number;
  readonly mtimeMs: number;
}

/** The size and mtime of a file, or `null` if it has no mtime. */
const stampOf = (
  sourcePath: string
): Effect.Effect<FootageStamp | null, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fsvc = yield* FileSystem.FileSystem;
    const info = yield* fsvc.stat(sourcePath);
    return Option.match(info.mtime, {
      onNone: () => null,
      onSome: (mtime) => ({
        size: Number(info.size),
        mtimeMs: mtime.getTime(),
      }),
    });
  });

/** The sidecar cache path for a source footage path. */
export const sidecarPathFor = (sourcePath: string): string =>
  path.resolve(sourcePath) + SIDECAR_SUFFIX;

/**
 * SHA-256 of a file's contents, streamed rather than read whole — raw footage
 * can be many gigabytes, and hashing it must not pull it all into memory.
 *
 * Streams through Effect's `FileSystem` (not raw `node:fs`) so the read is
 * DI-injectable and its I/O failures land in the typed error channel as a
 * `PlatformError`, consistent with the rest of this module (see
 * CODING_STANDARDS.md — prefer Effect primitives over promises/callbacks).
 */
export const computeFileContentHash = (
  sourcePath: string
): Effect.Effect<string, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fsvc = yield* FileSystem.FileSystem;
    const hash = createHash("sha256");
    yield* fsvc
      .stream(sourcePath)
      .pipe(
        Stream.runForEach((chunk) => Effect.sync(() => hash.update(chunk)))
      );
    return hash.digest("hex");
  });

/**
 * The file's content hash with the stamp it was taken at, for
 * `writeFootageTranscript`. Stamped BEFORE the read: a file written to while
 * it is hashed has a newer mtime than its stamp, so it is hashed again later.
 */
export const hashFootage = (
  sourcePath: string
): Effect.Effect<
  { readonly hash: string; readonly stamp: FootageStamp | null },
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const stamp = yield* stampOf(sourcePath);
    const hash = yield* computeFileContentHash(sourcePath);
    return { hash, stamp };
  });

/**
 * Read and parse the sidecar next to `sourcePath`, WITHOUT checking it against
 * the source file — `null` if there is no sidecar, it is malformed, or it is a
 * version this build does not understand. The raw primitive underneath
 * `readFootageTranscript`, which layers the freshness (hash) check on top; not
 * used on its own by any caller that could be served a stale transcript.
 */
export const readFootageSidecar = (
  sourcePath: string
): Effect.Effect<FootageSidecar | null, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fsvc = yield* FileSystem.FileSystem;
    const sidecarPath = sidecarPathFor(sourcePath);

    if (!(yield* fsvc.exists(sidecarPath))) return null;

    const raw = yield* fsvc.readFileString(sidecarPath);
    const parsed = yield* Effect.try(
      () => JSON.parse(raw) as FootageSidecar
    ).pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (parsed === null || parsed.version !== SIDECAR_VERSION) return null;

    return parsed;
  });

/**
 * Read the cached transcript for `sourcePath` AND confirm it still matches the
 * file on disk, returning `null` if there is none — where "none" also covers a
 * sidecar left behind by a DIFFERENT version of the file (its stored hash no
 * longer matches), or one whose source has since been deleted. This is what
 * `cvm footage transcript` reads, so a stale transcript is reported not-found
 * rather than served.
 */
export const readFootageTranscript = (
  sourcePath: string
): Effect.Effect<FootageSidecar | null, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fsvc = yield* FileSystem.FileSystem;

    const parsed = yield* readFootageSidecar(sourcePath);
    if (parsed === null) return null;

    // Can't confirm freshness against a source that is gone — treat as stale.
    if (!(yield* fsvc.exists(sourcePath))) return null;

    const stamp = yield* stampOf(sourcePath);
    const unchanged =
      stamp !== null &&
      parsed.sourceStamp?.size === stamp.size &&
      parsed.sourceStamp.mtimeMs === stamp.mtimeMs;
    if (unchanged) return parsed;

    const hash = yield* computeFileContentHash(sourcePath);
    if (parsed.sourceHash !== hash) return null;

    return parsed;
  });

/**
 * Write (overwriting any existing) the sidecar cache for `sourcePath`. The
 * caller passes the already-computed content hash so the write and the freshness
 * key can never disagree.
 */
export const writeFootageTranscript = (opts: {
  readonly sourcePath: string;
  readonly sourceHash: string;
  /** The stamp `hashFootage` took with `sourceHash`. */
  readonly sourceStamp: FootageStamp | null;
  readonly transcript: FootageTranscript;
}): Effect.Effect<FootageSidecar, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fsvc = yield* FileSystem.FileSystem;
    const sidecar: FootageSidecar = {
      version: SIDECAR_VERSION,
      sourcePath: path.resolve(opts.sourcePath),
      sourceHash: opts.sourceHash,
      ...(opts.sourceStamp !== null ? { sourceStamp: opts.sourceStamp } : {}),
      transcribedAt: new Date().toISOString(),
      words: opts.transcript.words,
      segments: opts.transcript.segments,
    };
    yield* fsvc.writeFileString(
      sidecarPathFor(opts.sourcePath),
      JSON.stringify(sidecar, null, 2)
    );
    return sidecar;
  });
