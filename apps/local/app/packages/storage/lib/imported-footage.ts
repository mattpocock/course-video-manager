import path from "node:path";

export {
  IMPORTED_FOOTAGE_FOLDER,
  isImportedFootage,
} from "./imported-footage-rule";

/**
 * What an import writes first, beside the file it will become
 * (`<file>.cvm-import-partial`). It is renamed into place only once its size
 * and checksum match the source, so a cut-off copy never has the final name.
 * One of an Imported Footage file's companions, like its transcript.
 */
export const IMPORT_PARTIAL_SUFFIX = ".cvm-import-partial";

/** The file types Footage comes in: what an import takes, and lists. */
export const FOOTAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".webm",
  ".avi",
  ".m4v",
]);

/** Whether a file name is one of {@link FOOTAGE_EXTENSIONS}, any case. */
export const isFootageFileName = (name: string): boolean =>
  FOOTAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
