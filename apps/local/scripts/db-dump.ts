/**
 * The nightly copy of production that lives outside PlanetScale
 * (`pnpm db:dump`, #2653). PlanetScale's backups die with the database or the
 * account; this one does not.
 *
 * - The connection string reaches `pg_dump` only through libpq environment
 *   variables, never argv, where `ps` would show it.
 * - `pg_dump` must be at least the server's major version. An older one
 *   refuses a newer server, and this says so before it starts.
 * - The dump is custom format (`-Fc`: compressed, and `pg_restore -t` can
 *   restore a single table). The file is created `0600` before the first byte
 *   is written, in a `0700` folder. It is written as `.partial` and renamed
 *   only once `pg_dump` succeeds, so a failed night never counts as a dump.
 * - After a good dump, only the newest `keep` dumps are kept.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export class DumpError extends Error {
  override readonly name = "DumpError";
}

/** URL query parameters libpq understands, and the variable each becomes. */
const PARAM_ENV: Record<string, string> = {
  sslmode: "PGSSLMODE",
  sslrootcert: "PGSSLROOTCERT",
  sslcert: "PGSSLCERT",
  sslkey: "PGSSLKEY",
  sslnegotiation: "PGSSLNEGOTIATION",
  channel_binding: "PGCHANNELBINDING",
  options: "PGOPTIONS",
  application_name: "PGAPPNAME",
  connect_timeout: "PGCONNECT_TIMEOUT",
  target_session_attrs: "PGTARGETSESSIONATTRS",
};

/** Every libpq variable this sets, so none leaks in from the caller's env. */
export const PG_ENV_NAMES = [
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  ...Object.values(PARAM_ENV),
] as const;

/** A `postgres://` URL as libpq environment variables. Names, never values, in errors. */
export const pgEnvFromUrl = (url: string): Record<string, string> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DumpError("The database URL does not parse.");
  }
  const env: Record<string, string> = {
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
  };
  for (const [key, value] of parsed.searchParams) {
    const name = PARAM_ENV[key];
    if (!name) {
      throw new DumpError(
        `The database URL has a parameter this script cannot pass to pg_dump: '${key}'.`
      );
    }
    env[name] = value;
  }
  return env;
};

/** The major version of the `pg_dump` that `pgDump` runs. */
export const pgDumpMajor = (pgDump: readonly string[]): number => {
  const [cmd, ...args] = pgDump;
  const result = spawnSync(cmd!, [...args, "--version"], { encoding: "utf8" });
  const major = /\(PostgreSQL\)\s+(\d+)/.exec(result.stdout ?? "")?.[1];
  if (result.status !== 0 || major === undefined) {
    throw new DumpError(`Could not run '${pgDump.join(" ")} --version'.`);
  }
  return Number(major);
};

const DUMP_NAME = /^cvm-\d{8}T\d{6}Z\.dump$/;

const dumpName = (now: Date): string =>
  `cvm-${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z.dump`;

const runPgDump = (
  pgDump: readonly string[],
  env: Record<string, string>,
  fd: number
): Promise<void> =>
  new Promise((resolve, reject) => {
    const [cmd, ...args] = pgDump;
    const child = spawn(cmd!, [...args, "--format=custom", "--no-password"], {
      env: { ...process.env, ...env },
      stdio: ["ignore", fd, "inherit"],
    });
    child.on("error", (cause) =>
      reject(new DumpError("pg_dump did not start.", { cause }))
    );
    child.on("close", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new DumpError(`pg_dump exited with ${code ?? signal}.`))
    );
  });

/** Deletes all but the newest `keep` dumps in `dir`; returns what it deleted. */
const prune = (dir: string, keep: number): string[] => {
  const dumps = fs
    .readdirSync(dir)
    .filter((f) => DUMP_NAME.test(f))
    .sort();
  const old = dumps.slice(0, Math.max(0, dumps.length - keep));
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  return old;
};

export interface WriteDumpOptions {
  readonly url: string;
  /** From `SHOW server_version_num` on the same server. */
  readonly serverMajor: number;
  readonly dir: string;
  readonly keep: number;
  readonly now: Date;
  /** argv before pg_dump's own flags: `["pg_dump"]`, or a wrapper in tests. */
  readonly pgDump: readonly string[];
}

export const writeDump = async (
  opts: WriteDumpOptions
): Promise<{ readonly file: string; readonly removed: readonly string[] }> => {
  const env = pgEnvFromUrl(opts.url);
  const clientMajor = pgDumpMajor(opts.pgDump);
  if (clientMajor < opts.serverMajor) {
    throw new DumpError(
      `pg_dump is version ${clientMajor} but the server is ${opts.serverMajor}; an older pg_dump refuses a newer server. Install postgresql-client-${opts.serverMajor} (https://www.postgresql.org/download/linux/ubuntu/).`
    );
  }

  fs.mkdirSync(opts.dir, { recursive: true, mode: 0o700 });
  const file = path.join(opts.dir, dumpName(opts.now));
  const partial = `${file}.partial`;
  const fd = fs.openSync(partial, "wx", 0o600);
  try {
    await runPgDump(opts.pgDump, env, fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(partial, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  fs.chmodSync(partial, 0o600);
  fs.renameSync(partial, file);
  return { file, removed: prune(opts.dir, opts.keep) };
};
