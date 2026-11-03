/**
 * `pnpm db:dump`: dump production (DIRECT_DATABASE_URL) to
 * `~/backups/cvm/cvm-<UTC timestamp>.dump`, keeping the newest 14. See
 * db-dump.ts for how. Installs no scheduler: `pnpm db:dump --cron-line` prints
 * the crontab line to add by hand.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DumpError, writeDump } from "./db-dump";
import { scriptPgClient } from "./script-database-url";

const DIR = path.join(os.homedir(), "backups/cvm");
const KEEP = 14;

if (process.argv.includes("--cron-line")) {
  const repo = path.resolve(
    fileURLToPath(new URL("../../..", import.meta.url))
  );
  const bin = path.dirname(process.execPath);
  console.log(
    `17 3 * * * cd ${repo} && mkdir -p -m 700 ${DIR} && PATH=${bin}:/usr/bin:/bin nice -n 19 pnpm db:dump >> ${DIR}/dump.log 2>&1`
  );
  process.exit(0);
}

const { client, url } = scriptPgClient({ direct: true });
await client.connect();
const { rows } = await client.query<{ server_version_num: string }>(
  "SHOW server_version_num"
);
await client.end();
const serverMajor = Math.floor(Number(rows[0]!.server_version_num) / 10000);

try {
  const { file, removed } = await writeDump({
    url,
    serverMajor,
    dir: DIR,
    keep: KEEP,
    now: new Date(),
    pgDump: ["pg_dump"],
  });
  console.log(`${new Date().toISOString()} dumped ${file}`);
  for (const f of removed) console.log(`  removed ${f} (keeping ${KEEP})`);
} catch (error) {
  if (!(error instanceof DumpError)) throw error;
  console.error(`${new Date().toISOString()} dump FAILED: ${error.message}`);
  process.exit(1);
}
