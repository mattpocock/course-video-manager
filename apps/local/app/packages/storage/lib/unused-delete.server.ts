import nodeFs from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  classifyStorageFile,
  UNUSED_FOOTAGE_BUCKET,
  type StorageOwnership,
} from "./buckets";
import {
  messageOf,
  realConfineOf,
  stopIfCancelled,
} from "./delete-safety.server";
import { isImportedFootage } from "./imported-footage";
import { loadStorageOwnership } from "./ownership.server";
import { STORAGE_FOLDERS } from "./storage-roots";
import {
  UNUSED_FOOTAGE_MIN_AGE_MS,
  type StorageUnusedDeleteResult,
} from "./unused-wire";
import {
  type Common,
  checkNotBusy,
  footagePathProblem,
  checkRoot,
  regularFileProblem,
  walk,
  extendsAny,
  removeEmptyParents,
  tally,
  held,
  logResult,
  StorageUnusedDeleteRefusedError,
  StorageUnusedDeleteFailedError,
  type UnusedFileRef,
  unusedDeleteFailure,
  type UnusedDeleteCancelled,
} from "./unused-checks.server";

/**
 * DELETING UNUSED FOOTAGE (#2157, #2423): deleted for good, after the
 * author's confirmation. There is no trash (ADR 0043 is superseded).
 *
 * Raw Footage is the one thing that can't be made again, so every check
 * leans towards keeping it:
 * - Never Imported Footage (`raw-footage/imported/`), at any age: it is
 *   Used or Unused Imported Footage, which CVM never deletes.
 * - Only Unused Footage: a file no Clip, live or archived, in any Video uses
 *   (read fresh from the database here, never taken from the page), no
 *   Recording Session still recording or under 7 days old uses, and no AV
 *   Calibration or Video names. A file changed in the last 7 days is kept.
 * - Every path is checked on disk: a regular file, never a link, whose real
 *   path is exactly where its root-relative path says (no link anywhere on
 *   the way), under the real `raw-footage/` of a real root. Checked again
 *   just before it is deleted.
 * - Refused while an export, a Publish, a move, a transcription, another
 *   delete or a recording is queued or running.
 *
 * Files named by the page are each looked at on their own (one `lstat`),
 * never by walking the whole of `raw-footage/`: on a WSL drive mount that
 * walk took ~11 s, and it ran for the confirmation, the start and the Job.
 */

type Candidate = {
  root: string;
  realRoot: string;
  relative: string;
  bytes: number;
};

type Found = { relative: string; bytes: number; mtimeMs: number };

const NOT_UNUSED = "a Clip or a recent Recording Session uses it";
const IMPORTED = "it is Imported Footage, which CVM never deletes";

/** Why a found file is kept (not Unused, or too new), or null to delete it. */
const keptReason = (
  ownership: StorageOwnership,
  protectedDirs: ReadonlySet<string>,
  file: Found,
  now: Date
): string | null => {
  if (isImportedFootage(file.relative)) return IMPORTED;
  const cls = classifyStorageFile(ownership, file.relative);
  if (cls?.bucketId !== UNUSED_FOOTAGE_BUCKET.id) return NOT_UNUSED;
  if (extendsAny(ownership.keptFootage, file.relative)) {
    return "an AV Calibration or a Video names it";
  }
  if (protectedDirs.has(path.posix.dirname(file.relative))) {
    return "it is in the folder of a Recording Session or AV Calibration still in use";
  }
  if (now.getTime() - file.mtimeMs < UNUSED_FOOTAGE_MIN_AGE_MS) {
    return "it changed less than 7 days ago";
  }
  return null;
};

/** One named file, looked at on its own: what it is, or why it is left. */
const lookAt = async (
  root: string,
  realRoot: string,
  relative: string
): Promise<Found | { left: string }> => {
  const problem = await regularFileProblem(root, realRoot, relative);
  if (problem !== null) return { left: `Left: ${problem}` };
  const info = await nodeFs.lstat(path.join(root, relative)).catch(() => null);
  if (info === null) return { left: "Left: it is gone" };
  return { relative, bytes: Number(info.size), mtimeMs: info.mtimeMs };
};

type Left = StorageUnusedDeleteResult["left"];
type Kept = StorageUnusedDeleteResult["kept"];

/** The named files on one root, each looked at on its own. */
const lookAtNamed = async (
  root: string,
  realRoot: string,
  only: readonly string[],
  left: Left
): Promise<Found[]> => {
  const found: Found[] = [];
  for (const relative of only) {
    const problem = footagePathProblem(relative);
    const file =
      problem === null
        ? await lookAt(root, realRoot, relative)
        : { left: `Left: ${problem}` };
    if ("left" in file) {
      left.push({ path: relative, location: root, message: file.left });
    } else found.push(file);
  }
  return found;
};

/** The files to consider on one root: the named ones, or all (one walk). */
const filesOn = async (
  root: string,
  realRoot: string,
  only: readonly string[] | undefined,
  left: Left
): Promise<Found[]> => {
  if (only !== undefined) return lookAtNamed(root, realRoot, only, left);
  // The whole bucket: one walk, links reported, never followed.
  return walk(root, path.join(root, STORAGE_FOLDERS.rawFootage), []).catch(
    () => []
  );
};

/** The files named on `root`, or undefined for every file on it. */
const namedOn = (
  files: readonly UnusedFileRef[] | undefined,
  root: string
): string[] | undefined =>
  files === undefined
    ? undefined
    : [
        ...new Set(files.filter((f) => f.location === root).map((f) => f.path)),
      ].sort();

/** What would go from one root, every check but the delete's own. */
const candidatesOn = async (opts: {
  root: string;
  only: readonly string[] | undefined;
  realConfine: string | null;
  ownership: StorageOwnership;
  protectedDirs: ReadonlySet<string>;
  now: Date;
  kept: Kept;
  left: Left;
}): Promise<Candidate[]> => {
  const { root, only, left } = opts;
  if (only !== undefined && only.length === 0) return [];
  const checked = await checkRoot(
    root,
    STORAGE_FOLDERS.rawFootage,
    opts.realConfine
  );
  if (checked.problem !== null || checked.realFolder === null) {
    for (const p of checked.problem === null ? [] : (only ?? [])) {
      left.push({
        path: p,
        location: root,
        message: `Left: ${checked.problem}`,
      });
    }
    return [];
  }
  const out: Candidate[] = [];
  for (const file of await filesOn(root, checked.realRoot, only, left)) {
    const reason = keptReason(
      opts.ownership,
      opts.protectedDirs,
      file,
      opts.now
    );
    if (reason === null) {
      out.push({
        root,
        realRoot: checked.realRoot,
        relative: file.relative,
        bytes: file.bytes,
      });
    } else if (
      only !== undefined ||
      (reason !== NOT_UNUSED && reason !== IMPORTED)
    ) {
      // Whole-bucket runs only look at Unused Footage; a file named on the
      // page that is not is reported.
      opts.kept.push({ path: file.relative, location: root, reason });
    }
  }
  return out;
};

/**
 * Delete Unused Footage for good (#2157, #2423).
 *
 * `files` keeps it to the files named (root and root-relative path, from the
 * per-bucket page); absent, every Unused Footage file on every root. Each is
 * classified again from the database here: a file a Clip uses, a Recording
 * Session still recording or under 7 days old, an AV Calibration, or a file
 * changed in the last 7 days is kept and reported. One that fails a check on
 * disk, or that Windows won't let go of, is left and reported; the rest
 * still go.
 */
export const deleteUnusedFootage = (
  opts: Common & { readonly files?: readonly UnusedFileRef[] }
): Effect.Effect<
  StorageUnusedDeleteResult,
  | StorageUnusedDeleteRefusedError
  | StorageUnusedDeleteFailedError
  | UnusedDeleteCancelled
> =>
  held(
    "a delete of Unused Footage",
    Effect.gen(function* () {
      const now = opts.now ?? new Date();
      const dryRun = opts.dryRun ?? false;
      yield* checkNotBusy(opts, true);
      const ownership = yield* loadStorageOwnership(
        opts.db,
        opts.roots,
        now
      ).pipe(
        Effect.mapError(
          (e) => new StorageUnusedDeleteFailedError({ message: e.message })
        )
      );
      // A Recording Session's (or AV Calibration's) folder in use keeps
      // everything in it, not just the files a row names.
      const protectedDirs = new Set(
        [...ownership.recordingSessionFootage, ...ownership.keptFootage]
          .map((p) => path.posix.dirname(p))
          .filter((d) => d !== STORAGE_FOLDERS.rawFootage && d !== ".")
      );

      return yield* Effect.tryPromise({
        try: async (): Promise<StorageUnusedDeleteResult> => {
          const realConfine = await realConfineOf(opts.confineTo);
          const kept: Kept = [];
          const left: Left = [];
          const done = tally();
          for (const f of opts.files ?? []) {
            if (!opts.roots.includes(f.location)) {
              left.push({
                path: f.path,
                location: f.location,
                message: "Left: not a Storage Root",
              });
            }
          }
          const candidates: Candidate[] = [];
          for (const root of opts.roots) {
            candidates.push(
              ...(await candidatesOn({
                root,
                only: namedOn(opts.files, root),
                realConfine,
                ownership,
                protectedDirs,
                now,
                kept,
                left,
              }))
            );
          }
          let progressed = 0;
          for (const c of candidates) {
            stopIfCancelled(opts.cancelRequested);
            const step = await deleteOne(c, dryRun);
            if (step === null) done.add(c.root, c.bytes);
            else {
              left.push({
                path: c.relative,
                location: c.root,
                message: `Left: ${step}`,
              });
            }
            progressed += 1;
            opts.onProgress?.(progressed, candidates.length);
          }
          return { dryRun, done: done.list(), kept, left };
        },
        catch: unusedDeleteFailure,
      });
    }),
    opts.alreadyHeld
  ).pipe(Effect.tap(logResult));

/** Delete one file for good; null when done, else why it was left. */
const deleteOne = async (
  c: Candidate,
  dryRun: boolean
): Promise<string | null> => {
  // Checked again just before the delete.
  const problem = await regularFileProblem(c.root, c.realRoot, c.relative);
  if (problem !== null) return problem;
  if (dryRun) return null;
  const file = path.join(c.root, c.relative);
  try {
    await nodeFs.unlink(file);
  } catch (error) {
    // Windows has it open, say.
    return messageOf(error);
  }
  await removeEmptyParents(
    path.dirname(file),
    path.join(c.root, STORAGE_FOLDERS.rawFootage)
  );
  return null;
};
