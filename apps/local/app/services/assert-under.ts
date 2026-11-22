import nodeFs from "node:fs";
import path from "node:path";
import { Data, Effect } from "effect";

/**
 * The one guard between a path the app did not build itself — read from the
 * database, or out of a request — and a write or delete on disk.
 *
 * A thumbnail row stores an absolute `filePath`. On a verify-cvm test clone
 * that path still names Matt's real PNG, so a save that wrote straight to it
 * overwrote his file. Every write or delete of such a path goes through
 * `assertUnder` first, with the env-configured folder that kind of file lives
 * in (`VIDEO_FILES_DIR`, or a fixed folder under a Storage Root, …) —
 * the same folders verify-cvm points at its run's `scratch/`. A path outside
 * that folder is refused, so a clone can only ever touch its own scratch.
 *
 * The `local/fs-writes` lint rule fails any fs write, unlink or rm in routes
 * and services whose path did not come out of this helper.
 */
export class PathOutsideBaseDirError extends Data.TaggedError(
  "PathOutsideBaseDirError"
)<{
  readonly path: string;
  readonly baseDir: string;
  readonly message: string;
}> {}

const isStrictlyInside = (base: string, target: string): boolean => {
  const relative = path.relative(base, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

/**
 * Where `target` really lands on disk: the realpath of its nearest existing
 * ancestor (the target itself when it exists), with the not-yet-created tail
 * appended. A symlink anywhere along the way is followed, so a link inside
 * the base that points out of it is seen for what it is.
 *
 * Returns undefined for a dangling symlink: writing through one creates its
 * target wherever it points, and we cannot tell where that is.
 */
const realLocation = (target: string): string | undefined => {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(nodeFs.realpathSync(current), ...[...tail].reverse());
    } catch {
      if (nodeFs.lstatSync(current, { throwIfNoEntry: false })) {
        // It exists (lstat sees it) but cannot be resolved: a dangling or
        // looping symlink, or an unreadable directory. Refuse it.
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return target;
    tail.push(path.basename(current));
    current = parent;
  }
};

const refuse = (target: string, baseDir: string, why: string) =>
  new PathOutsideBaseDirError({
    path: target,
    baseDir,
    message: `Refusing to touch ${target}: ${why} ${baseDir}`,
  });

/**
 * Resolve `target` and throw a `PathOutsideBaseDirError` unless it lies
 * strictly inside `baseDir` — both lexically (no `..` out of it, no unrelated
 * absolute path) and on disk (no symlink out of it). The base folder itself is
 * refused too: nothing should write over or delete a whole store.
 *
 * Returns the resolved absolute path, which is what callers write to.
 */
export function assertUnder(baseDir: string, target: string): string {
  if (baseDir.trim() === "") {
    throw refuse(
      target,
      baseDir,
      "no base folder is configured, so it is not under"
    );
  }
  if (target.trim() === "") {
    throw refuse(target, baseDir, "the path is empty, so it is not under");
  }

  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, target);

  if (!isStrictlyInside(base, resolved)) {
    throw refuse(target, baseDir, "it is not inside");
  }

  const realBase = realLocation(base) ?? base;
  const realTarget = realLocation(resolved);
  if (realTarget === undefined) {
    throw refuse(target, baseDir, "it is an unresolvable symlink under");
  }
  if (!isStrictlyInside(realBase, realTarget)) {
    throw refuse(target, baseDir, "a symlink takes it outside");
  }

  return resolved;
}

/** `assertUnder` as an Effect, failing with a typed `PathOutsideBaseDirError`. */
export const assertUnderEffect = (
  baseDir: string,
  target: string
): Effect.Effect<string, PathOutsideBaseDirError> =>
  Effect.try({
    try: () => assertUnder(baseDir, target),
    catch: (error) =>
      error instanceof PathOutsideBaseDirError
        ? error
        : refuse(
            target,
            baseDir,
            `${String(error)} while checking it is under`
          ),
  });

/** Whether `assertUnder(baseDir, target)` would accept `target`. */
export function isUnder(baseDir: string, target: string): boolean {
  try {
    assertUnder(baseDir, target);
    return true;
  } catch {
    return false;
  }
}
