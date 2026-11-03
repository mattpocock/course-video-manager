import { sql } from "drizzle-orm";
import type pg from "pg";
import {
  connectAdmin,
  makeTestPool,
  testDrizzle,
  urlForDatabase,
  type TestDb,
} from "./test-postgres.js";
import "./test-db-context.js";

export type { TestDb };

/** The pool under a test database — what {@link withQueryLog} wraps. */
export type TestDbClient = pg.Pool;

type ProvidedTestDatabase = {
  serverUrl: string;
  runPrefix: string;
  template: string;
};

const provided = async (): Promise<ProvidedTestDatabase> => {
  const { inject } = await import("vitest");
  const value = inject("testDatabase");
  if (!value) {
    throw new Error(
      "No test database: this vitest config has no globalSetup for it. Add packages/core/test-utils/global-setup.ts to `globalSetup` and test-utils/release-test-dbs.setup.ts to `setupFiles` (ADR 0046)."
    );
  }
  return value;
};

/** One admin connection per worker, for CREATE / DROP DATABASE. */
let admin: Promise<pg.Client> | undefined;
const adminClient = (serverUrl: string) => {
  admin ??= connectAdmin(serverUrl).then((client) => {
    client.on("error", () => {
      admin = undefined;
    });
    return client;
  });
  return admin;
};

type Opened = { name: string; pool: pg.Pool };

/** The databases the current test file opened, dropped by {@link releaseTestDatabases}. */
const openedThisFile: Opened[] = [];
let counter = 0;

const openDatabase = async (
  template: string | undefined,
  maxConnections: number
) => {
  const { serverUrl, runPrefix } = await provided();
  const name = `${runPrefix}${process.pid}_${++counter}`;
  const client = await adminClient(serverUrl);
  await client.query(
    template
      ? `CREATE DATABASE "${name}" TEMPLATE "${template}"`
      : `CREATE DATABASE "${name}"`
  );
  const pool = makeTestPool(urlForDatabase(serverUrl, name), maxConnections);
  const opened = { name, pool };
  openedThisFile.push(opened);
  const close = () => closeDatabase(opened);
  return {
    pool,
    db: testDrizzle(pool),
    close,
    url: urlForDatabase(serverUrl, name),
  };
};

const closeDatabase = async (opened: Opened) => {
  const index = openedThisFile.indexOf(opened);
  if (index === -1) return;
  openedThisFile.splice(index, 1);
  await opened.pool.end().catch(() => {});
  const { serverUrl } = await provided();
  const client = await adminClient(serverUrl);
  await client.query(`DROP DATABASE IF EXISTS "${opened.name}" WITH (FORCE)`);
};

/**
 * Closes and drops every database the current test file created. Registered
 * as an `afterAll` by `release-test-dbs.setup.ts`, so a test file never needs
 * to — and a worker that runs many files (`isolate: false`) never holds more
 * than one file's databases.
 */
export const releaseTestDatabases = async () => {
  for (const opened of [...openedThisFile]) await closeDatabase(opened);
};

/**
 * A fresh, empty database with NO schema, and a drizzle handle over it — for
 * tests that apply the migrations (or push the schema) themselves.
 *
 * This file and `test-postgres.ts` are where every test database is built:
 * scripts/check-db-clients.sh flags `new Pool(` / `drizzle(` anywhere else.
 */
export const createBlankDb = async () => {
  // One connection: these tests set session state (`session_replication_role`)
  // and expect the next statement to see it.
  const { pool, db, close, url } = await openDatabase(undefined, 1);
  // `url` is for tests that need more sessions than this one connection
  // (`makeTestPool(url)`), e.g. two concurrent migrators.
  return { client: pool, db, close, url };
};

/** A second drizzle handle over an existing test database that reports every query it sends. */
export const withQueryLog = (
  client: TestDbClient,
  logQuery: (query: string) => void
): TestDb => testDrizzle(client, { logQuery });

/**
 * A database of its own for one test file, with the schema already in it: a
 * `CREATE DATABASE … TEMPLATE` clone of the database the global setup pushed
 * the schema into once (ADR 0046). Call it in `beforeAll`, and reset between
 * tests with {@link truncateAllTables}. It is dropped when the file finishes.
 */
export const createTestDb = async () => {
  const { template } = await provided();
  const { pool, db, close } = await openDatabase(template, 4);
  return { client: pool, testDb: db, close };
};

/** Every public table, quoted — read once per database, the schema never changes mid-file. */
const tableListCache = new WeakMap<TestDb, string>();

const quotedTableList = async (testDb: TestDb): Promise<string> => {
  const cached = tableListCache.get(testDb);
  if (cached !== undefined) return cached;
  const { rows } = await testDb.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const list = rows
    .map((r) => `"${r.tablename.replaceAll('"', '""')}"`)
    .join(", ");
  tableListCache.set(testDb, list);
  return list;
};

/**
 * Truncates every table in the public schema with CASCADE.
 *
 * Call this in `beforeEach` to give each test a clean database without
 * creating a new one. One TRUNCATE naming every table, not one per table.
 */
export const truncateAllTables = async (testDb: TestDb) => {
  const tables = await quotedTableList(testDb);
  if (tables.length === 0) return;
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${tables} CASCADE`));
};

/**
 * A database that cannot answer: every query rejects.
 *
 * For tests of the "the database itself failed" path.
 */
export const createUnreachableDb = (): TestDb => {
  const down = () => Promise.reject(new Error("database is unreachable"));
  const client = { query: down, connect: down };
  return testDrizzle(client as unknown as pg.Client);
};
