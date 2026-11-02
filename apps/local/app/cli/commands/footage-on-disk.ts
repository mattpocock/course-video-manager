import { existsSync } from "node:fs";
import path from "node:path";
import { toRootRelative } from "@/packages/storage";
import { findStoragePathSync } from "@/packages/storage/server";
import {
  readStorageRootsOrNone,
  readStorageRootsSync,
} from "@/services/storage-roots";

/**
 * How the `cvm` verbs that take a Footage path (`footage transcribe`,
 * `footage transcript`, `clip add --source`) find it, and how a Clip stores it.
 */

/**
 * The file a typed path names: as typed when it exists, otherwise — for a
 * root-relative path (`raw-footage/take.mkv`) — the first Storage Root that
 * has it. Unchanged when neither finds it, so a "no such footage file" names
 * what was typed.
 */
export const footageOnDisk = (typed: string): string => {
  if (existsSync(typed) || path.isAbsolute(typed)) return typed;
  try {
    return findStoragePathSync(typed, readStorageRootsSync()) ?? typed;
  } catch {
    // No STORAGE_ROOTS: only a path as typed can be found.
    return typed;
  }
};

/**
 * The path a Clip stores for Footage found at `onDisk`: root-relative when the
 * file is under a Storage Root, so moving it between drives changes no row and
 * no Export Hash; otherwise exactly as typed (ADR 0040).
 */
export const footagePathToStore = (typed: string, onDisk: string): string => {
  const stored = toRootRelative(path.resolve(onDisk), readStorageRootsOrNone());
  return path.isAbsolute(stored) ? typed : stored;
};
