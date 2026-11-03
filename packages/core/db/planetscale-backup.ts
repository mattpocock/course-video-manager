/**
 * Backup first, then migrate: the only way production is migrated — by the
 * `apps/remote` production build (`migrate-on-deploy.ts`, #2655) and by the
 * break-glass `pnpm db:migrate:prod` (#2653).
 *
 * 1. Take the PlanetScale service token, `<SERVICE_TOKEN_ID>:<SERVICE_TOKEN>`,
 *    which is PlanetScale's `Authorization` header value as-is. The caller
 *    reads it (an env var in the build, a `chmod 600` file by hand). It never
 *    reaches a log line, an error message or argv.
 * 2. Create an on-demand backup of the production branch.
 * 3. Poll it until its state is `success`. `failed`, `canceled` and `ignored`
 *    are terminal; so is running out of time.
 * 4. Print the backup's ID and how to restore it.
 * 5. Only then run the migrate.
 *
 * Any failure throws a `BackupFirstMigrateError` before step 5. There is no
 * fallback and no way to skip the backup: an escape hatch is one an agent can
 * type for itself.
 *
 * API: https://planetscale.com/docs/api/reference/create_backup and
 * https://planetscale.com/docs/api/reference/get_backup.
 */
export const PLANETSCALE_API = "https://api.planetscale.com/v1";

export interface PlanetScaleTarget {
  readonly organization: string;
  readonly database: string;
  readonly branch: string;
}

/** Not secret, so committed. Matt confirmed the three names (#2653). */
export const PRODUCTION_TARGET: PlanetScaleTarget = {
  organization: "mattpocockvoice",
  database: "course-video-manager",
  branch: "main",
};

export class BackupFirstMigrateError extends Error {
  override readonly name = "BackupFirstMigrateError";
}

/** The states the API documents for a backup. */
type BackupState =
  "pending" | "running" | "success" | "failed" | "canceled" | "ignored";

interface BackupResponse {
  readonly id: string;
  readonly state: BackupState;
}

/**
 * The `Authorization` header value, checked for shape. `source` names where it
 * came from (a file path, an env var name) — the value itself is never echoed.
 */
export const parseServiceToken = (raw: string, source: string): string => {
  const token = raw.trim();
  if (!/^[^\s:]+:[^\s:]+$/.test(token)) {
    throw new BackupFirstMigrateError(
      `${source} must hold one line, <SERVICE_TOKEN_ID>:<SERVICE_TOKEN>.`
    );
  }
  return token;
};

const backupsUrl = (apiBase: string, t: PlanetScaleTarget): string =>
  `${apiBase}/organizations/${encodeURIComponent(t.organization)}/databases/${encodeURIComponent(t.database)}/branches/${encodeURIComponent(t.branch)}/backups`;

/** Status and PlanetScale's error code only: a body is never echoed. */
const describeFailure = async (res: Response): Promise<string> => {
  let code = "";
  try {
    const body = (await res.json()) as { code?: unknown };
    if (typeof body.code === "string") code = ` (${body.code})`;
  } catch {
    // Not JSON: the status says enough.
  }
  return `HTTP ${res.status}${code}`;
};

const callApi = async (
  url: string,
  authorization: string,
  init: { method: "GET" | "POST"; body?: unknown },
  what: string
): Promise<BackupResponse> => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    throw new BackupFirstMigrateError(
      `Could not reach the PlanetScale API to ${what}.`,
      { cause }
    );
  }
  if (!res.ok) {
    throw new BackupFirstMigrateError(
      `PlanetScale refused to ${what}: ${await describeFailure(res)}.`
    );
  }
  const body = (await res.json()) as Partial<BackupResponse>;
  if (typeof body.id !== "string" || typeof body.state !== "string") {
    throw new BackupFirstMigrateError(
      `PlanetScale's answer to "${what}" has no backup id or state.`
    );
  }
  return { id: body.id, state: body.state };
};

/** `true` when ready, `false` to keep waiting; throws on a terminal failure. */
const isReady = (backup: BackupResponse): boolean => {
  switch (backup.state) {
    case "success":
      return true;
    case "pending":
    case "running":
      return false;
    case "failed":
    case "canceled":
    case "ignored":
      throw new BackupFirstMigrateError(
        `Backup ${backup.id} ended in state '${backup.state}'.`
      );
    default:
      throw new BackupFirstMigrateError(
        `Backup ${backup.id} is in an unknown state '${String(backup.state)}'.`
      );
  }
};

export interface BackupThenMigrateOptions {
  /** `PLANETSCALE_API`, or a loopback fake in tests. */
  readonly apiBase: string;
  /** From {@link parseServiceToken}. */
  readonly authorization: string;
  readonly target: PlanetScaleTarget;
  readonly backupName: string;
  readonly retentionDays: number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly log: (line: string) => void;
  /** The existing migrate. Called only once the backup is `success`. */
  readonly migrate: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitUntilReady = async (
  opts: BackupThenMigrateOptions,
  authorization: string,
  created: BackupResponse
): Promise<void> => {
  const url = `${backupsUrl(opts.apiBase, opts.target)}/${encodeURIComponent(created.id)}`;
  const deadline = Date.now() + opts.timeoutMs;
  let backup = created;
  while (!isReady(backup)) {
    if (Date.now() >= deadline) {
      throw new BackupFirstMigrateError(
        `Backup ${created.id} was still '${backup.state}' after ${Math.round(opts.timeoutMs / 1000)}s.`
      );
    }
    await sleep(opts.pollIntervalMs);
    backup = await callApi(
      url,
      authorization,
      { method: "GET" },
      "read the backup"
    );
  }
};

export const backupThenMigrate = async (
  opts: BackupThenMigrateOptions
): Promise<{ readonly backupId: string }> => {
  const { authorization } = opts;
  const { organization, database, branch } = opts.target;

  opts.log(
    `Creating a PlanetScale backup of ${organization}/${database}/${branch} (${opts.backupName})…`
  );
  const created = await callApi(
    backupsUrl(opts.apiBase, opts.target),
    authorization,
    {
      method: "POST",
      body: {
        name: opts.backupName,
        retention_unit: "day",
        retention_value: opts.retentionDays,
      },
    },
    "create a backup"
  );
  opts.log(
    `Backup ${created.id} is '${created.state}'. Waiting for 'success'…`
  );
  await waitUntilReady(opts, authorization, created);

  opts.log("");
  opts.log(`Backup ready: ${created.id}`);
  opts.log(
    "To restore it (always onto a NEW branch, then repoint the app by hand):"
  );
  opts.log(
    `  pscale backup restore ${database} <new-branch-name> ${created.id} --org ${organization}`
  );
  opts.log("");

  opts.log("Running the migration…");
  await opts.migrate();
  return { backupId: created.id };
};
