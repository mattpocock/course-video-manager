/**
 * One-off: rewrite every absolute path under a Storage Root to its
 * root-relative form (#2104). Matt runs it, from main, against production.
 *
 *   pnpm storage:migrate-paths            # dry run: report only, writes nothing
 *   pnpm storage:migrate-paths --apply    # rewrite, in one transaction
 *
 * --apply refuses while this checkout's app (port 5173) or Sidecar is
 * running: stop `pnpm dev` first. Safe in either order with `storage:rename-exports`, and safe to run twice:
 * a relative path is never touched again. Paths under no root (Recording
 * Sessions in ~/Videos) are reported and left as they are. It writes around
 * the Draft guard on purpose — see packages/core/services/storage-path-migration.server.ts.
 */
import { migrateStoragePaths } from "@cvm/core/services/storage-path-migration.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { readStorageRootsSync } from "@/services/storage-roots";
import { scriptDrizzle } from "./script-database-url";
import { CVM_APP_PORT, refuseApplyWhileCvmRuns } from "./running-cvm";
import { sidecarSocketPath } from "@/services/sidecar-socket.server";
import { log } from "@/packages/log";

const apply = process.argv.includes("--apply");
const roots = readStorageRootsSync();
log.info(`Storage Roots: ${roots.join(", ")}`);
log.info(apply ? "Mode: APPLY" : "Mode: dry run (pass --apply to write)");

if (apply) {
  await refuseApplyWhileCvmRuns({
    appPort: CVM_APP_PORT,
    sidecarSocket: sidecarSocketPath(),
  });
}

const { db } = scriptDrizzle();
const report = await migrateStoragePaths(db as Database, { roots, apply });

const print = (c: (typeof report.columns)[number]) => {
  const under = c.underRoot.map((r) => `${r.root}: ${r.rows}`).join(", ");
  log.info(
    `  ${c.column}: under a root ${under}; already relative ${c.alreadyRelative}; not under any root ${c.unmappable}; not normalized (left as stored) ${c.notNormalized}`
  );
  for (const sample of c.unmappableSamples) log.info(`      e.g. ${sample}`);
};

log.info(apply ? "\nRewritten:" : "\nWould rewrite:");
report.columns.forEach(print);
log.info("\nReported only (moved by #2105, never rewritten here):");
report.reportedOnly.forEach(print);
log.info(
  "\nPaths not under any root are left exactly as they are and keep working."
);
process.exit(0);
