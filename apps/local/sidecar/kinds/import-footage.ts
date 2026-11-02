import { Effect } from "effect";
import { storageRootsConfig } from "@/services/storage-roots";
import { isImportedFootage, rootRelativePath } from "@/packages/storage";
import {
  FootageImportError,
  asFootageImportError,
  copyIntoImportedFootage,
  removeImportPartial,
} from "@/packages/storage/import";
import { FOOTAGE_IMPORTED_EVENT } from "@/features/jobs/import-footage-job";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { FOOTAGE_IMPORT_POLICY } from "../retry-policy";

/** The destination is not Imported Footage on the first Storage Root. */
const destinationOf = (destination: string) =>
  Effect.gen(function* () {
    const roots = yield* storageRootsConfig;
    const relative = rootRelativePath(destination, [roots[0]]);
    if (relative === null || !isImportedFootage(relative)) {
      return yield* new FootageImportError({
        message: `${destination} is not under raw-footage/imported/ on the first Storage Root (${roots[0]}); nothing was copied`,
      });
    }
    return { root: roots[0], relative };
  });

/**
 * **Footage import**, enqueued by `cvm footage import` once the file passed
 * its 16:9 probe: copy it to the name the command chose under
 * `raw-footage/imported/` (`@/packages/storage/import`). The source is only
 * read, never moved or deleted; the copy is renamed into place only once its
 * size and checksum match; nothing is overwritten. A `transcribe-footage` Job
 * waits on this one. A lost run is redone from the start.
 */
export const importFootageJobKind = defineJobKind({
  ...FOOTAGE_IMPORT_POLICY,
  params: JOB_PARAMS["import-footage"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const { root, relative } = yield* destinationOf(params.destination);
      yield* ctx.emit("stage", { stage: "copying" });
      const placed = yield* Effect.tryPromise({
        try: (signal) =>
          copyIntoImportedFootage({
            source: params.source,
            destination: params.destination,
            root,
            signal,
          }),
        catch: asFootageImportError,
      });
      yield* Effect.logInfo("import-footage: done", {
        source: params.source,
        path: relative,
        ...placed,
      });
      yield* ctx.emit(FOOTAGE_IMPORTED_EVENT, { path: relative, ...placed });
    }),
  // Never a partial left behind by a Job that will not run again.
  afterFinalFailure: (params) =>
    destinationOf(params.destination).pipe(
      Effect.flatMap(({ root }) =>
        Effect.tryPromise({
          try: () =>
            removeImportPartial({ destination: params.destination, root }),
          catch: asFootageImportError,
        })
      ),
      Effect.ignore
    ),
});
