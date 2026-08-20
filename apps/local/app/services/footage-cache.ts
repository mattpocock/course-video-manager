import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FootageTranscript } from "./footage-chunking";

/**
 * The on-disk cache for a **Footage** transcript (see CONTEXT.md "Footage").
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
 */

const SIDECAR_SUFFIX = ".transcript.json";
const SIDECAR_VERSION = 1 as const;

export interface FootageSidecar {
  readonly version: typeof SIDECAR_VERSION;
  /** The source file this transcript was produced from (absolute). */
  readonly sourcePath: string;
  /** SHA-256 of the source file's contents when it was transcribed. */
  readonly sourceHash: string;
  /** When the transcript was produced (ISO 8601). */
  readonly transcribedAt: string;
  readonly words: FootageTranscript["words"];
  readonly segments: FootageTranscript["segments"];
}

/** The sidecar cache path for a source footage path. */
export const sidecarPathFor = (sourcePath: string): string =>
  path.resolve(sourcePath) + SIDECAR_SUFFIX;

/**
 * SHA-256 of a file's contents, streamed rather than read whole — raw footage
 * can be many gigabytes, and hashing it must not pull it all into memory.
 */
export const computeFileContentHash = (
  sourcePath: string
): Effect.Effect<string> =>
  Effect.async<string>((resume) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(sourcePath);
    stream.on("error", (error) => resume(Effect.die(error)));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resume(Effect.succeed(hash.digest("hex"))));
  });

/**
 * Read and parse the sidecar next to `sourcePath`, WITHOUT checking it against
 * the source file — `null` if there is no sidecar, it is malformed, or it is a
 * version this build does not understand. This is what `cvm clip add` uses: it
 * only needs the cached words, and re-hashing (possibly gigabytes of) source on
 * every clip would be wasteful and would require the source present at all.
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
  readonly transcript: FootageTranscript;
}): Effect.Effect<FootageSidecar, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fsvc = yield* FileSystem.FileSystem;
    const sidecar: FootageSidecar = {
      version: SIDECAR_VERSION,
      sourcePath: path.resolve(opts.sourcePath),
      sourceHash: opts.sourceHash,
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
