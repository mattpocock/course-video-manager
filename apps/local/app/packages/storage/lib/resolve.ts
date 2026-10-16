import nodeFs from "node:fs";
import { FileSystem } from "@effect/platform";
import { Data, Effect, Option } from "effect";
import {
  rootLabel,
  rootRelativePath,
  storageCandidates,
  type StorageRoots,
} from "./storage-roots";
import { realDriveRefusal } from "./real-drives";

/**
 * A root-relative file is on no Storage Root. `offlineRoots` are the roots
 * that could not be read at all (an unplugged drive), which is the usual
 * reason; the message names them.
 */
export class StorageFileNotFoundError extends Data.TaggedError(
  "StorageFileNotFoundError"
)<{
  readonly path: string;
  readonly offlineRoots: readonly string[];
  readonly message: string;
}> {}

const notFoundMessage = (
  what: string,
  relative: string,
  offlineRoots: readonly string[]
) =>
  offlineRoots.length === 0
    ? `${what} not found on any Storage Root: ${relative}`
    : `${what} not found (${offlineRoots.map(rootLabel).join(", ")} offline?): ${relative}`;

/**
 * Whether a Storage Root can be read right now. A root that is missing, not
 * mounted, or a stale WSL mount (it exists but can't be listed) is Offline.
 * Only lists the root's top level: it reads, never writes.
 */
export const rootIsOnline = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readDirectory(root).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false)
    );
  });

/** Where a stored path is, or why an agent's process may not look. */
type Located =
  | { readonly _tag: "found"; readonly path: string }
  | { readonly _tag: "refused"; readonly message: string }
  | { readonly _tag: "missing" };

/**
 * Every path a stored path may be at, in lookup order: the stored path itself
 * when it is under no root, otherwise one candidate per root. In an agent's
 * process a path on a real drive is refused here, before anything touches it
 * (`real-drives.ts`) — the one place every Footage read is resolved.
 */
const lookupPaths = (
  stored: string,
  roots: StorageRoots
): { readonly paths: string[] } | { readonly refused: string } => {
  const relative = rootRelativePath(stored, roots);
  const paths =
    relative === null ? [stored] : storageCandidates(relative, roots);
  for (const p of paths) {
    const refusal = realDriveRefusal(p);
    if (refusal !== undefined) return { refused: refusal };
  }
  return { paths };
};

const locate = (stored: string, roots: StorageRoots) =>
  Effect.gen(function* () {
    const lookup = lookupPaths(stored, roots);
    if ("refused" in lookup) {
      return { _tag: "refused", message: lookup.refused } as Located;
    }
    if (rootRelativePath(stored, roots) === null) {
      return { _tag: "found", path: stored } as Located;
    }
    const fs = yield* FileSystem.FileSystem;
    for (const candidate of lookup.paths) {
      const exists = yield* fs
        .exists(candidate)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) return { _tag: "found", path: candidate } as Located;
    }
    return { _tag: "missing" } as Located;
  });

const warnRefused = (message: string) =>
  console.warn(`[storage] refused: ${message}`);

/**
 * Where a stored path is on disk, as an Option: the first root that has it,
 * or None. An absolute path under no root is not CVM's to manage and is
 * returned as it is, whether or not it exists. In an agent's process a path
 * on a real drive is None (and a warning).
 */
export const findStoragePath = (stored: string, roots: StorageRoots) =>
  Effect.map(locate(stored, roots), (located) => {
    if (located._tag === "refused") warnRefused(located.message);
    return located._tag === "found"
      ? Option.some(located.path)
      : Option.none<string>();
  });

/**
 * Where a stored path is on disk: the first Storage Root that has it. Fails
 * with {@link StorageFileNotFoundError}, naming the roots that are offline,
 * when none does. `what` names the file in that message ("Footage").
 */
export const resolveStoragePath = (
  stored: string,
  roots: StorageRoots,
  what: string
): Effect.Effect<string, StorageFileNotFoundError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const located = yield* locate(stored, roots);
    if (located._tag === "found") return located.path;
    const relative = rootRelativePath(stored, roots) ?? stored;
    if (located._tag === "refused") {
      warnRefused(located.message);
      return yield* new StorageFileNotFoundError({
        path: relative,
        offlineRoots: [],
        message: `${what} refused — on a real drive, which an agent's server never reads: ${relative}`,
      });
    }
    const offlineRoots: string[] = [];
    for (const root of roots) {
      if (!(yield* rootIsOnline(root))) offlineRoots.push(root);
    }
    return yield* new StorageFileNotFoundError({
      path: relative,
      offlineRoots,
      message: notFoundMessage(what, relative, offlineRoots),
    });
  });

/**
 * {@link findStoragePath} for the few synchronous readers (a streaming
 * route, the Clip Mockup store): the first root that has the file, or null.
 * In an agent's process a path on a real drive is null (and a warning).
 */
export const findStoragePathSync = (
  stored: string,
  roots: StorageRoots
): string | null => {
  const lookup = lookupPaths(stored, roots);
  if ("refused" in lookup) {
    warnRefused(lookup.refused);
    return null;
  }
  if (rootRelativePath(stored, roots) === null) return stored;
  for (const candidate of lookup.paths) {
    if (nodeFs.existsSync(candidate)) return candidate;
  }
  return null;
};
