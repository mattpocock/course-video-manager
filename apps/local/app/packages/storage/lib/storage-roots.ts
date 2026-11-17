import path from "node:path";
import type { StorageFolder } from "./storage-folders";

/**
 * The Storage Roots, in order: every drive CVM's files may be on (`/mnt/d`,
 * `/mnt/e`). Never empty. The first root is where new files are written, and
 * the first root that has a file is where it is read from.
 */
export type StorageRoots = readonly [string, ...string[]];

export { STORAGE_FOLDERS, type StorageFolder } from "./storage-folders";

/** The `STORAGE_ROOTS` value could not be read as an ordered list of roots. */
export class InvalidStorageRootsError extends Error {
  readonly _tag = "InvalidStorageRootsError";
}

/**
 * Parse the `STORAGE_ROOTS` setting: comma-separated absolute directories,
 * in lookup order. Trailing slashes are dropped. Refused: an empty list, a
 * relative root, a root listed twice, and a root inside another root (a file
 * under both would have two root-relative paths, and so two Export Hashes).
 */
export const parseStorageRoots = (raw: string): StorageRoots => {
  const roots = raw
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "")
    .map((r) => (r === "/" ? r : r.replace(/\/+$/, "")));

  if (roots.length === 0) {
    throw new InvalidStorageRootsError(
      "STORAGE_ROOTS is empty: list at least one directory, e.g. STORAGE_ROOTS=/mnt/d,/mnt/e"
    );
  }
  for (const root of roots) {
    if (!path.posix.isAbsolute(root) || root === "/") {
      throw new InvalidStorageRootsError(
        `STORAGE_ROOTS: "${root}" is not an absolute directory below /`
      );
    }
  }
  for (const [i, a] of roots.entries()) {
    for (const [j, b] of roots.entries()) {
      if (i === j) continue;
      if (a === b) {
        throw new InvalidStorageRootsError(`STORAGE_ROOTS lists "${a}" twice`);
      }
      if (a.startsWith(`${b}/`)) {
        throw new InvalidStorageRootsError(
          `STORAGE_ROOTS: "${a}" is inside "${b}"; roots must not nest`
        );
      }
    }
  }
  return roots as unknown as StorageRoots;
};

/**
 * The root-relative form of a path a row stores, or null when it is an
 * absolute path under no Storage Root (a Recording Session in `~/Videos`, a
 * repo asset): CVM does not manage that file, and it is read where it is.
 *
 * A relative path is already root-relative and comes back unchanged. A legacy
 * absolute path under a root comes back as its relative form, so the code
 * reads a row the same before and after the data migration rewrites it.
 */
export const rootRelativePath = (
  stored: string,
  roots: readonly string[]
): string | null => {
  if (!path.posix.isAbsolute(stored)) return path.posix.normalize(stored);
  const normalized = path.posix.normalize(stored);
  for (const root of roots) {
    if (normalized.startsWith(`${root}/`)) {
      return normalized.slice(root.length + 1);
    }
  }
  return null;
};

/**
 * The path as the Export Hash and the database see it: root-relative when the
 * file is under a Storage Root, otherwise exactly as given. Which root holds
 * the file never shows.
 */
export const toRootRelative = (
  stored: string,
  roots: readonly string[]
): string => rootRelativePath(stored, roots) ?? stored;

/** Every place a root-relative path may be, in lookup order. */
export const storageCandidates = (
  relative: string,
  roots: StorageRoots
): string[] => roots.map((root) => path.posix.join(root, relative));

/** A Storage Folder on the first root: where new files of that kind go. */
export const writeFolder = (
  roots: StorageRoots,
  folder: StorageFolder
): string => path.posix.join(roots[0], folder);

/** A Storage Folder on every root, in lookup order. */
export const folderOnEveryRoot = (
  roots: StorageRoots,
  folder: StorageFolder
): string[] => roots.map((root) => path.posix.join(root, folder));

/**
 * How a root is named to Matt: `/mnt/e` is "E:", anything else its path.
 */
export const rootLabel = (root: string): string => {
  const drive = /^\/mnt\/([a-z])$/.exec(root);
  return drive ? `${drive[1]!.toUpperCase()}:` : root;
};
