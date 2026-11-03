/**
 * The PlanetScale service token for the break-glass `pnpm db:migrate:prod`,
 * read from `~/.config/cvm/planetscale-backup-token` (#2653). The file holds
 * one line, `<SERVICE_TOKEN_ID>:<SERVICE_TOKEN>`, and must not be readable by
 * group or others. The production build reads the same value from the
 * `PLANETSCALE_BACKUP_TOKEN` env var instead (#2655).
 */
import fs from "node:fs";
import {
  BackupFirstMigrateError,
  parseServiceToken,
} from "@cvm/core/db/planetscale-backup";

export const readServiceToken = (tokenPath: string): string => {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(tokenPath);
  } catch {
    throw new BackupFirstMigrateError(
      `No PlanetScale service token at ${tokenPath}. Matt creates it (read_backups + write_backups only) — see the deploy-migration skill.`
    );
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new BackupFirstMigrateError(
      `${tokenPath} is readable by group or others. Run: chmod 600 ${tokenPath}`
    );
  }
  return parseServiceToken(fs.readFileSync(tokenPath, "utf8"), tokenPath);
};
