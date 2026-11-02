/**
 * The `import-footage` Job (`sidecar/kinds/import-footage.ts`), as
 * `cvm footage import` knows it: it enqueues one to copy a file in as
 * Imported Footage, then a `transcribe-footage` Job waiting on it.
 */
export const IMPORT_FOOTAGE_JOB_KIND = "import-footage";

/**
 * The file is in place: `{ path, copied, bytes }`, `path` root-relative and
 * `copied` false when identical bytes were already there.
 */
export const FOOTAGE_IMPORTED_EVENT = "footage-imported";
