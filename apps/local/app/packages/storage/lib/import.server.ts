import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import nodeFs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Data } from "effect";
import { assertUnder } from "@/services/assert-under";
import {
  IMPORT_PARTIAL_SUFFIX,
  IMPORTED_FOOTAGE_FOLDER,
  isFootageFileName,
} from "./imported-footage";
import {
  hashFile,
  placeNoReplace,
  removePartial,
  type Control,
} from "./move-copy.server";
import { lstatOrNull } from "./move-io.server";
import type { StorageRoots } from "./storage-roots";

/**
 * IMPORTING FOOTAGE: copying a file CVM did not film into
 * `raw-footage/imported/` on the first Storage Root. The source is only ever
 * opened for reading, and nothing is ever overwritten: the copy is written to
 * `<file>.cvm-import-partial` and renamed into place only once its size and
 * checksum match the source.
 */

/** Why an import did not place its file. The source is untouched. */
export class FootageImportError extends Data.TaggedError("FootageImportError")<{
  readonly message: string;
}> {}

/** Any failure of the functions here, as a {@link FootageImportError}. */
export const asFootageImportError = (error: unknown): FootageImportError =>
  error instanceof FootageImportError
    ? error
    : new FootageImportError({
        message: error instanceof Error ? error.message : String(error),
      });

const noCancel = (signal: AbortSignal): Control => ({
  cancelRequested: () => false,
  signal,
});

const sameBytes = async (a: string, b: string, control: Control) =>
  (await hashFile(a, control, () => undefined)) ===
  (await hashFile(b, control, () => undefined));

/**
 * Where an import of `source` goes, under `folder`: the source's own name,
 * or the next free `-2`, `-3` … when that name holds different bytes.
 * `existing` when a file there already has the source's bytes: then nothing
 * needs copying.
 */
export const chooseImportDestination = async (
  source: string,
  folder: string
): Promise<{ readonly destination: string; readonly existing: boolean }> => {
  const size = (await nodeFs.stat(source)).size;
  const { name, ext } = path.parse(source);
  const control = noCancel(new AbortController().signal);
  for (let n = 1; ; n++) {
    const destination = path.join(
      folder,
      n === 1 ? `${name}${ext}` : `${name}-${n}${ext}`
    );
    const there = await lstatOrNull(destination);
    if (there === null) return { destination, existing: false };
    if (
      there.isFile() &&
      there.size === size &&
      (await sameBytes(source, destination, control))
    ) {
      return { destination, existing: true };
    }
  }
};

/**
 * Copy `source` to `destination`, which must be under `raw-footage/imported/`
 * on `root`. A cut-off run's partial is started again; a file already at
 * `destination` is kept if it has the source's bytes, and is never replaced.
 */
export const copyIntoImportedFootage = async (opts: {
  readonly source: string;
  readonly destination: string;
  readonly root: string;
  readonly signal: AbortSignal;
}): Promise<{ readonly copied: boolean; readonly bytes: number }> => {
  const control = noCancel(opts.signal);
  const folder = path.join(opts.root, IMPORTED_FOOTAGE_FOLDER);
  const destination = assertUnder(folder, opts.destination);
  const partial = assertUnder(folder, `${destination}${IMPORT_PARTIAL_SUFFIX}`);

  const before = await lstatOrNull(opts.source);
  if (before === null || !before.isFile()) {
    throw new FootageImportError({
      message: `no such file to import: ${opts.source}`,
    });
  }
  const bytes = Number(before.size);
  const taken = () =>
    new FootageImportError({
      message: `a different file is already at ${destination}; never overwritten. Run 'cvm footage import' again for the next free name.`,
    });

  const there = await lstatOrNull(destination);
  if (there !== null) {
    if (
      there.isFile() &&
      Number(there.size) === bytes &&
      (await sameBytes(opts.source, destination, control))
    ) {
      return { copied: false, bytes };
    }
    throw taken();
  }

  await nodeFs.mkdir(path.dirname(destination), { recursive: true });
  // A run cut off mid-copy left this; it is never resumed into, only redone.
  await removePartial(partial);
  try {
    const hash = createHash("sha256");
    // `wx`: never through something already there; `flush`: on the disk
    // before it is checked.
    await pipeline(
      createReadStream(opts.source, { flags: "r" }),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(partial, { flags: "wx", flush: true }),
      { signal: opts.signal }
    );

    const after = await lstatOrNull(opts.source);
    const copy = await lstatOrNull(partial);
    if (
      after === null ||
      Number(after.size) !== bytes ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new FootageImportError({
        message: `${opts.source} changed while it was copied (still being written?); try again once it is finished`,
      });
    }
    if (
      copy === null ||
      Number(copy.size) !== bytes ||
      (await hashFile(partial, control, () => undefined)) !== hash.digest("hex")
    ) {
      throw new FootageImportError({
        message: `the copy of ${opts.source} did not match it (size or checksum), so it was removed`,
      });
    }
    if ((await placeNoReplace(partial, destination)) === "exists") {
      throw taken();
    }
  } catch (error) {
    await removePartial(partial);
    throw error;
  }
  return { copied: true, bytes };
};

/** Remove an import's partial copy of `destination`, if one is there. */
export const removeImportPartial = async (opts: {
  readonly destination: string;
  readonly root: string;
}) =>
  removePartial(
    assertUnder(
      path.join(opts.root, IMPORTED_FOOTAGE_FOLDER),
      `${opts.destination}${IMPORT_PARTIAL_SUFFIX}`
    )
  );

/** One Imported Footage file, where it was found. */
export interface ImportedFootageFile {
  /** Root-relative, as a Clip stores it. */
  readonly path: string;
  /** The Storage Root it is on. */
  readonly location: string;
  readonly size: number;
}

/**
 * Every Imported Footage file on every Storage Root, by root-relative path
 * (the first root that has one wins, as a lookup does). An Offline root
 * lists nothing. Companions (transcripts, partial copies) are not Footage.
 */
export const findImportedFootage = async (
  roots: StorageRoots
): Promise<readonly ImportedFootageFile[]> => {
  const found = new Map<string, ImportedFootageFile>();
  for (const root of roots) {
    const folder = path.join(root, IMPORTED_FOOTAGE_FOLDER);
    const entries = await nodeFs
      .readdir(folder, { recursive: true, withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !isFootageFileName(entry.name)) continue;
      const full = path.join(entry.parentPath, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (found.has(relative)) continue;
      const info = await lstatOrNull(full);
      if (info === null) continue;
      found.set(relative, {
        path: relative,
        location: root,
        size: Number(info.size),
      });
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
};
