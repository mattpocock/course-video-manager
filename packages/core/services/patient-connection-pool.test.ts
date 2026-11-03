import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { createTestDb } from "../test-utils/test-db.js";
import { testDrizzle } from "../test-utils/test-postgres.js";
import { makeConnectionPool } from "./drizzle-service.server.js";

/**
 * The patient pool (#2621): what a caller that can wait — a Sidecar Job, a
 * Publish first — connects through. It waits out a network drop by retrying
 * what cannot double-apply, and nothing else.
 *
 * The database is the real test Postgres. The fault is in the client: a
 * `pg.Client` that fails its connect as a DNS outage does, or loses its
 * connection mid-statement, as many times as a test asks.
 */

const faults = { connects: 0, drops: 0, connectCalls: 0, queryCalls: 0 };

class FlakyClient extends pg.Client {
  override connect(): Promise<pg.Client>;
  override connect(callback: Parameters<pg.Client["connect"]>[0]): void;
  override connect(
    callback?: Parameters<pg.Client["connect"]>[0]
  ): Promise<pg.Client> | void {
    faults.connectCalls += 1;
    if (faults.connects > 0) {
      faults.connects -= 1;
      const error = Object.assign(
        new Error("getaddrinfo ENOTFOUND db.example"),
        { code: "ENOTFOUND" }
      );
      if (callback) {
        setImmediate(() => (callback as (err: Error) => void)(error));
        return;
      }
      return Promise.reject(error);
    }
    return callback ? super.connect(callback) : super.connect();
  }

  // `query`'s overload set, passed through whole: only its first argument,
  // the statement, is read here.
  override query(...args: unknown[]): any {
    const statement = args[0] as string | { text?: string } | undefined;
    const text = typeof statement === "string" ? statement : statement?.text;
    if (!/^(begin|commit|rollback)$/i.test(text ?? "")) {
      faults.queryCalls += 1;
      if (faults.drops > 0) {
        faults.drops -= 1;
        return Promise.reject(new Error("Connection terminated unexpectedly"));
      }
    }
    return (super.query as (...a: unknown[]) => unknown)(...args);
  }
}

let url: string;
/** The test database's own pool, never faulted: what a test reads back with. */
let plain: pg.Pool;
const pools: pg.Pool[] = [];

beforeAll(async () => {
  const { client } = await createTestDb();
  plain = client;
  url = client.options.connectionString!;
  await plain.query(
    "CREATE TABLE IF NOT EXISTS patience_probe (id serial PRIMARY KEY, note text NOT NULL)"
  );
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  Object.assign(faults, {
    connects: 0,
    drops: 0,
    connectCalls: 0,
    queryCalls: 0,
  });
});

const PATIENCE = { windowMs: 2_000, firstDelayMs: 10, maxDelayMs: 50 };

const open = (patience?: typeof PATIENCE) => {
  const pool = makeConnectionPool(url, { patience, Client: FlakyClient });
  pools.push(pool);
  return testDrizzle(pool);
};

const rows = async () => {
  const { rows } = await plain.query("SELECT note FROM patience_probe");
  return rows.map((row: { note: string }) => row.note);
};

describe("the patient connection pool (#2621)", () => {
  it("waits out a DNS outage, then lands the write once", async () => {
    const db = open(PATIENCE);
    faults.connects = 3;
    await db.execute(
      sql`INSERT INTO patience_probe (note) VALUES ('after the outage')`
    );
    expect(await rows()).toContain("after the outage");
    expect(faults.connectCalls).toBe(4);
    expect(faults.queryCalls).toBe(1);
  });

  it("waits out a DNS outage before a transaction begins", async () => {
    const db = open(PATIENCE);
    faults.connects = 3;
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO patience_probe (note) VALUES ('in a transaction')`
      );
    });
    expect(await rows()).toContain("in a transaction");
  });

  it("reads again when its connection drops mid-read", async () => {
    const db = open(PATIENCE);
    faults.drops = 1;
    const result = await db.execute(sql`SELECT 41 + 1 AS answer`);
    expect(result.rows).toEqual([{ answer: 42 }]);
    expect(faults.queryCalls).toBe(2);
  });

  it("never sends a write again when its connection drops mid-write", async () => {
    const db = open(PATIENCE);
    faults.drops = 1;
    await expect(
      db.execute(sql`INSERT INTO patience_probe (note) VALUES ('cut off')`)
    ).rejects.toThrow();
    expect(faults.queryCalls).toBe(1);
  });

  it("never sends a statement again inside a transaction, even a read", async () => {
    const db = open(PATIENCE);
    faults.drops = 1;
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT 1`);
      })
    ).rejects.toThrow();
    expect(faults.queryCalls).toBe(1);
  });

  it("gives up once its window has passed", async () => {
    const db = open({ ...PATIENCE, windowMs: 300 });
    faults.connects = Number.POSITIVE_INFINITY;
    const startedAt = Date.now();
    await expect(db.execute(sql`SELECT 1`)).rejects.toMatchObject({
      cause: { code: "ENOTFOUND" },
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("fails an SQL error at once", async () => {
    const db = open(PATIENCE);
    await expect(
      db.execute(sql`SELECT * FROM no_such_table`)
    ).rejects.toThrow();
    expect(faults.queryCalls).toBe(1);
  });

  it("without patience, fails the first time the database cannot be reached", async () => {
    const db = open();
    faults.connects = 1;
    await expect(db.execute(sql`SELECT 1`)).rejects.toMatchObject({
      cause: { code: "ENOTFOUND" },
    });
    expect(faults.connectCalls).toBe(1);
  });
});
