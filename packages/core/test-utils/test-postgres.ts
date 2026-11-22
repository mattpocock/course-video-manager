import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "drizzle-orm";
import pg from "pg";
import * as schema from "../db/schema.js";

/**
 * The one Postgres server every DB-backed test talks to (ADR 0046).
 *
 * Locally it is a Docker container, `cvm-test-postgres`, started on first use
 * and reused by every later run — from any worktree, concurrently. Its data
 * lives on a tmpfs inside the container, so it is fast and throwaway: a
 * restart of the container (or of Docker Desktop) wipes it, and the next run
 * rebuilds its template. Set `CVM_TEST_DATABASE_URL` to point the suite at a
 * server of your own instead (a Sandcastle sandbox reaches the host's
 * container through `host.docker.internal`).
 */

export const CONTAINER_NAME = "cvm-test-postgres";
const IMAGE = "postgres:17";
const HOST_PORT = 54329;
const DEFAULT_URL = `postgres://postgres@127.0.0.1:${HOST_PORT}/postgres`;

/** Hosts the suite may connect to: a test server is never a remote database. */
const ALLOWED_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "host.docker.internal",
]);

/**
 * Every database this suite creates starts with this, then a tag for the
 * machine that created it — so a run only ever cleans up after its own
 * machine, never after a sandbox sharing the server.
 */
export const DB_PREFIX = "cvmt_";
export const machineTag = createHash("sha256")
  .update(hostname())
  .digest("hex")
  .slice(0, 8);

/** The admin connection string (database `postgres`) of the test server. */
export const testServerUrl = (): string => {
  const url = process.env.CVM_TEST_DATABASE_URL ?? DEFAULT_URL;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `CVM_TEST_DATABASE_URL points at ${host}. The test suite creates and drops databases, so it only talks to a local server (${[...ALLOWED_HOSTS].join(", ")}).`
    );
  }
  return url;
};

/** The same server, a different database. */
export const urlForDatabase = (serverUrl: string, database: string): string => {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
};

/**
 * Every client the test suite opens is built here, after the host check above
 * — the lint rule local/db-clients flags `new Pool(` / `drizzle(` anywhere else.
 */
export const connectAdmin = async (url: string): Promise<pg.Client> => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
};

/** A small pool onto one test database (a test file needs a handful at most). */
export const makeTestPool = (url: string, max = 4): pg.Pool => {
  const pool = new pg.Pool({ connectionString: url, max });
  // A database dropped under an idle connection must not crash the worker.
  pool.on("error", () => {});
  return pool;
};

export type TestDb = NodePgDatabase<typeof schema>;

/** A drizzle handle over a test pool, optionally logging every query. */
export const testDrizzle = (
  client: pg.Pool | pg.Client,
  logger?: Logger
): TestDb => drizzle(client, { schema, logger }) as TestDb;

const docker = (args: string[]): string =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const DOCKER_HELP = `The CVM test suite runs its database tests against one Postgres container, "${CONTAINER_NAME}" (ADR 0046).

Start Docker Desktop (and turn on WSL integration for this distro), then run the tests again — the container is created on first use and reused afterwards.

To use a Postgres server of your own instead, set CVM_TEST_DATABASE_URL (it must be local).`;

/** Starts `cvm-test-postgres` if it is not already running. Idempotent. */
const ensureContainer = () => {
  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    throw new Error(`Docker is not running.\n\n${DOCKER_HELP}`);
  }

  let state: string | undefined;
  try {
    state = docker(["inspect", "-f", "{{.State.Running}}", CONTAINER_NAME]);
  } catch {
    state = undefined;
  }
  if (state === "true") return;

  try {
    if (state === undefined) {
      docker([
        "run",
        "--detach",
        "--name",
        CONTAINER_NAME,
        "--label",
        "cvm.purpose=test-suite",
        "--publish",
        `127.0.0.1:${HOST_PORT}:5432`,
        "--env",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        // Data on a tmpfs: tests never need it to survive a restart.
        "--tmpfs",
        "/var/lib/postgresql/data:rw,size=2g",
        "--shm-size",
        "256m",
        "--memory",
        "3g",
        IMAGE,
        "-c",
        "fsync=off",
        "-c",
        "synchronous_commit=off",
        "-c",
        "full_page_writes=off",
        "-c",
        "max_connections=500",
      ]);
    } else {
      docker(["start", CONTAINER_NAME]);
    }
  } catch (error) {
    // Another run started it between our inspect and our run/start.
    const message = error instanceof Error ? error.message : String(error);
    if (!/already in use|Conflict/i.test(message)) {
      throw new Error(
        `Could not start the "${CONTAINER_NAME}" container: ${message}\n\n${DOCKER_HELP}`
      );
    }
  }
};

const waitForServer = async (url: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const client = await connectAdmin(url);
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(
    `The test Postgres at ${url} did not answer within ${timeoutMs / 1000}s: ${String(lastError)}\n\n${DOCKER_HELP}`
  );
};

/**
 * Makes sure the test server is up and answering, and returns its admin URL.
 * Starts the Docker container unless `CVM_TEST_DATABASE_URL` names a server.
 */
export const startTestServer = async (): Promise<string> => {
  const url = testServerUrl();
  if (!process.env.CVM_TEST_DATABASE_URL) ensureContainer();
  await waitForServer(url, 60_000);
  return url;
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Drops databases this machine's earlier runs left behind — a run killed
 * before its teardown (Ctrl-C, an OOM) leaves its databases on the server.
 * A database belongs to a dead run when the run's process is gone.
 */
export const dropOrphanedDatabases = async (admin: pg.Client) => {
  const { rows } = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE $1`,
    [`${DB_PREFIX}${machineTag}\\_%`]
  );
  for (const { datname } of rows) {
    const runPid = Number(datname.split("_")[2]);
    if (Number.isFinite(runPid) && !isAlive(runPid)) {
      await admin
        .query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`)
        .catch(() => {});
    }
  }
};

/** Drops every database whose name starts with `prefix`. */
export const dropDatabasesWithPrefix = async (
  admin: pg.Client,
  prefix: string
) => {
  const { rows } = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE starts_with(datname, $1)`,
    [prefix]
  );
  for (const { datname } of rows) {
    await admin
      .query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`)
      .catch(() => {});
  }
};
