/**
 * One-off: rename every Exported Video (and its .sha256 digest) from its old,
 * absolute-path Export Hash to its root-relative one (#2104), so switching to
 * root-relative paths re-encodes nothing. Matt runs it, from main.
 *
 *   pnpm storage:rename-exports           # dry run: plan only, renames nothing
 *   pnpm storage:rename-exports --apply   # rename, then turn export GC back on
 *
 * --apply refuses while this checkout's app (port 5173) or Sidecar is
 * running — an app started before the switch runs the OLD GC, which would
 * delete every renamed export. Stop `pnpm dev` first.
 *
 * Export GC stays OFF until an --apply completes (it writes
 * finished-videos/.export-hash-root-relative.json on the first root). Any
 * problem — an export named after a Course that no Video matches, a new name
 * already taken, two exports colliding — aborts with ZERO changes. Safe in
 * either order with `storage:migrate-paths`, and safe to run again.
 */
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { readStorageRootsSync } from "@/services/storage-roots";
import {
  applyExportRename,
  planExportRenameOnDisk,
} from "@/services/export-hash-rename";
import { scriptDrizzle } from "./script-database-url";
import { CVM_APP_PORT, refuseApplyWhileCvmRuns } from "./running-cvm";
import { sidecarSocketPath } from "@/services/sidecar-socket.server";
import { log } from "@/packages/log";

const apply = process.argv.includes("--apply");
const roots = readStorageRootsSync();
log.info(`Storage Roots: ${roots.join(", ")}`);
log.info(apply ? "Mode: APPLY" : "Mode: dry run (pass --apply to rename)");

if (apply) {
  await refuseApplyWhileCvmRuns({
    appPort: CVM_APP_PORT,
    sidecarSocket: sidecarSocketPath(),
  });
}

const { db } = scriptDrizzle();
const videos = await listVideosForExportHash(db as Database);
log.info(`Videos in the database: ${videos.length}`);

const program = Effect.gen(function* () {
  const plan = yield* planExportRenameOnDisk(videos, roots);
  const exportsToRename = plan.renames.filter((r) => r.from.endsWith(".mp4"));
  log.info(`\nExports to rename: ${exportsToRename.length}`);
  log.info(`  (files incl. digests: ${plan.renames.length})`);
  for (const { from, to } of plan.renames) log.info(`  ${from}\n    -> ${to}`);
  log.info(`Already at their new name: ${plan.alreadyCurrent.length}`);
  log.info(
    `Matching no Video, left alone (Standalone/Shorts/legacy): ${plan.leftAlone.length}`
  );
  for (const file of plan.leftAlone) log.info(`  ${file}`);

  if (plan.problems.length > 0) {
    log.error(
      `\nABORTED: ${plan.problems.length} problem(s). Nothing was renamed.`
    );
    for (const p of plan.problems) log.error(`  [${p.kind}] ${p.message}`);
    return 1;
  }
  if (!apply) {
    log.info(
      "\nDry run: nothing renamed. Re-run with --apply to rename and re-enable export GC."
    );
    return 0;
  }
  const { renamed } = yield* applyExportRename(plan, roots);
  log.info(`\nRenamed ${renamed} file(s). Export GC is back on.`);
  return 0;
});

const code = await Effect.runPromise(
  program.pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        log.error(`\nFAILED: ${error.message}`);
        return 1;
      })
    ),
    Effect.provide(NodeContext.layer)
  )
);
process.exit(code);
