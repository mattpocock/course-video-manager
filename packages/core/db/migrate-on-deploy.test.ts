import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createBlankDb } from "../test-utils/test-db.js";
import { makeTestPool, testDrizzle } from "../test-utils/test-postgres.js";
import {
  migrateOnDeploy,
  type MigrateOnDeployOptions,
} from "./migrate-on-deploy.js";

/**
 * The `apps/remote` production build's migrate step (#2655), over a real local
 * Postgres and a loopback fake PlanetScale API. Nothing here reaches either
 * real service.
 */

const TOKEN = "pscale_tkn_id123:pscale_tkn_SECRETVALUE";
const TARGET = { organization: "org", database: "cvm", branch: "main" };
const BACKUPS = "/v1/organizations/org/databases/cvm/branches/main/backups";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** Every POST is a new backup; `states` answers its GETs in turn. */
const fakePlanetScale = async (
  api: { createStatus?: number; states?: readonly string[] } = {}
) => {
  const seen: { method: string; authorization: string | undefined }[] = [];
  let created = 0;
  const polls = new Map<string, number>();
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        authorization: req.headers.authorization,
      });
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      const states = api.states ?? ["success"];
      if (req.method === "POST" && req.url === BACKUPS) {
        if (api.createStatus && api.createStatus >= 400) {
          return reply(api.createStatus, { code: "forbidden" });
        }
        return reply(201, { id: `bk_${++created}`, state: "pending" });
      }
      const id = req.url?.startsWith(`${BACKUPS}/`)
        ? req.url.slice(BACKUPS.length + 1)
        : undefined;
      if (req.method === "GET" && id) {
        const n = polls.get(id) ?? 0;
        polls.set(id, n + 1);
        return reply(200, {
          id,
          state: states[Math.min(n, states.length - 1)],
        });
      }
      reply(404, { code: "not_found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise((r) => server.close(r)));
  const { port } = server.address() as AddressInfo;
  return {
    apiBase: `http://127.0.0.1:${port}/v1`,
    seen,
    posts: () => seen.filter((s) => s.method === "POST").length,
  };
};

/**
 * A migrations folder of `count` real Drizzle migrations, each creating one
 * table, and its journal. `upTo` lets a test write the first N only.
 */
const migrationsFolder = (count: number) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-migrate-on-deploy-"));
  cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
  const entries = Array.from({ length: count }, (_, idx) => ({
    idx,
    version: "7",
    when: 1_800_000_000_000 + idx * 1000,
    tag: `000${idx}_table_${idx}`,
    breakpoints: true,
  }));
  const write = (upTo: number) => {
    fs.mkdirSync(path.join(dir, "meta"), { recursive: true });
    for (const e of entries.slice(0, upTo)) {
      fs.writeFileSync(
        path.join(dir, `${e.tag}.sql`),
        `CREATE TABLE "t_${e.idx}" ("id" integer);`
      );
    }
    fs.writeFileSync(
      path.join(dir, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: entries.slice(0, upTo),
      })
    );
  };
  return { dir, entries, write };
};

/** A blank test database, migrated with the first `applied` of `count` migrations. */
const database = async (opts: { count: number; applied: number }) => {
  const blank = await createBlankDb();
  const folder = migrationsFolder(opts.count);
  folder.write(opts.applied);
  if (opts.applied > 0)
    await migrate(blank.db, { migrationsFolder: folder.dir });
  folder.write(opts.count);
  const pool = (): pg.Pool => {
    const p = makeTestPool(blank.url, 2);
    cleanups.push(() => p.end());
    return p;
  };
  const tables = async (): Promise<string[]> => {
    const { rows } = await blank.client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    return rows.map((r) => r.tablename);
  };
  return { folder, pool, tables };
};

const options = (
  db: Awaited<ReturnType<typeof database>>,
  apiBase: string,
  overrides: Partial<MigrateOnDeployOptions> = {}
) => {
  const lines: string[] = [];
  const direct = db.pool();
  const opts: MigrateOnDeployOptions = {
    vercelEnv: "production",
    journal: db.folder.entries,
    pooled: db.pool(),
    direct,
    applyMigrations: () =>
      migrate(testDrizzle(direct), { migrationsFolder: db.folder.dir }),
    backupToken: TOKEN,
    planetscale: {
      apiBase,
      target: TARGET,
      pollIntervalMs: 5,
      timeoutMs: 2_000,
    },
    log: (line) => lines.push(line),
    ...overrides,
  };
  return { opts, lines };
};

describe("migrateOnDeploy", () => {
  it("never migrates a preview build, and fails it when production is behind", async () => {
    const db = await database({ count: 2, applied: 1 });
    const api = await fakePlanetScale();
    const { opts } = options(db, api.apiBase, { vercelEnv: "preview" });

    await expect(migrateOnDeploy(opts)).rejects.toThrow(
      "production has not applied 0001_table_1"
    );
    expect(api.seen).toEqual([]);
    expect(await db.tables()).toEqual(["t_0"]);
  });

  it("passes a preview build when production is up to date, with no backup", async () => {
    const db = await database({ count: 2, applied: 2 });
    const api = await fakePlanetScale();
    const { opts } = options(db, api.apiBase, { vercelEnv: "preview" });

    await expect(migrateOnDeploy(opts)).resolves.toEqual({
      kind: "up-to-date",
      latest: "0001_table_1",
    });
    expect(api.seen).toEqual([]);
  });

  it("takes no backup and needs no direct URL or token when nothing is pending", async () => {
    const db = await database({ count: 2, applied: 2 });
    const api = await fakePlanetScale();
    const { opts } = options(db, api.apiBase, {
      direct: undefined,
      backupToken: undefined,
    });

    await expect(migrateOnDeploy(opts)).resolves.toEqual({
      kind: "up-to-date",
      latest: "0001_table_1",
    });
    expect(api.seen).toEqual([]);
  });

  it("backs up, waits for success, prints the backup ID, then migrates", async () => {
    const db = await database({ count: 3, applied: 1 });
    const api = await fakePlanetScale({ states: ["running", "success"] });
    const { opts, lines } = options(db, api.apiBase, {
      now: () => new Date("2026-11-03T12:34:56.789Z"),
    });

    await expect(migrateOnDeploy(opts)).resolves.toEqual({
      kind: "migrated",
      latest: "0002_table_2",
      applied: ["0001_table_1", "0002_table_2"],
      backupId: "bk_1",
    });
    expect(api.seen.map((s) => s.method)).toEqual(["POST", "GET", "GET"]);
    expect(api.seen.every((s) => s.authorization === TOKEN)).toBe(true);
    expect(await db.tables()).toEqual(["t_0", "t_1", "t_2"]);
    const log = lines.join("\n");
    expect(log).toContain("pre-migrate-0002_table_2-20261103t123456z");
    expect(log).toContain("Backup ready: bk_1");
    expect(log.indexOf("Backup ready: bk_1")).toBeLessThan(
      log.indexOf("Running the migration")
    );
    expect(log).not.toContain("SECRETVALUE");
  });

  it("does not migrate when the backup fails", async () => {
    const db = await database({ count: 2, applied: 1 });
    const api = await fakePlanetScale({ states: ["running", "failed"] });
    const { opts } = options(db, api.apiBase);

    await expect(migrateOnDeploy(opts)).rejects.toThrow(
      "ended in state 'failed'"
    );
    expect(await db.tables()).toEqual(["t_0"]);
  });

  it("does not migrate when PlanetScale refuses the backup", async () => {
    const db = await database({ count: 2, applied: 1 });
    const api = await fakePlanetScale({ createStatus: 403 });
    const { opts } = options(db, api.apiBase);

    await expect(migrateOnDeploy(opts)).rejects.toThrow("HTTP 403");
    expect(await db.tables()).toEqual(["t_0"]);
  });

  it("fails when the migration itself fails, after the backup", async () => {
    const db = await database({ count: 2, applied: 1 });
    fs.writeFileSync(
      path.join(db.folder.dir, "0001_table_1.sql"),
      "CREATE TABLE broken (;"
    );
    const api = await fakePlanetScale();
    const { opts } = options(db, api.apiBase);

    await expect(migrateOnDeploy(opts)).rejects.toThrow();
    expect(api.posts()).toBe(1);
    expect(await db.tables()).toEqual(["t_0"]);
  });

  it.each([
    ["DIRECT_DATABASE_URL", { direct: undefined }],
    ["PLANETSCALE_BACKUP_TOKEN", { backupToken: undefined }],
    ["PLANETSCALE_BACKUP_TOKEN", { backupToken: "SECRETVALUE-no-colon" }],
  ] as const)(
    "refuses, naming %s and not its value, before any backup",
    async (name, overrides) => {
      const db = await database({ count: 2, applied: 1 });
      const api = await fakePlanetScale();
      const { opts } = options(db, api.apiBase, overrides);

      const error = await migrateOnDeploy(opts).catch((e: unknown) => e);
      expect((error as Error).message).toContain(name);
      expect((error as Error).message).not.toContain("SECRETVALUE");
      expect(api.seen).toEqual([]);
      expect(await db.tables()).toEqual(["t_0"]);
    }
  );

  it("lets only one of two concurrent production builds back up and migrate", async () => {
    const db = await database({ count: 2, applied: 1 });
    const api = await fakePlanetScale({
      states: ["running", "running", "running", "success"],
    });
    const first = options(db, api.apiBase);
    const second = options(db, api.apiBase);

    const outcomes = await Promise.all([
      migrateOnDeploy(first.opts),
      migrateOnDeploy(second.opts),
    ]);

    expect(outcomes.map((o) => o.kind).sort()).toEqual([
      "migrated",
      "up-to-date",
    ]);
    expect(api.posts()).toBe(1);
    expect(await db.tables()).toEqual(["t_0", "t_1"]);
    expect([...first.lines, ...second.lines].join("\n")).toContain(
      "Another build already migrated production"
    );
  });
});
