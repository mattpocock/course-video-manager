import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/test-utils/test-db";
import { DumpError, PG_ENV_NAMES, pgEnvFromUrl, writeDump } from "./db-dump";

/**
 * Against the local test server only (`cvm-test-postgres`, Postgres 17). The
 * host's pg_dump may be older than the server, so `pg_dump` runs inside the
 * container: the same binary prod would need, fed the same environment
 * variables (`docker exec -e NAME` passes each one through).
 */
const CONTAINER = "cvm-test-postgres";
const PG_DUMP = [
  "docker",
  "exec",
  "-i",
  ...PG_ENV_NAMES.flatMap((name) => ["-e", name]),
  CONTAINER,
  "pg_dump",
];

let containerUrl: string;

beforeAll(async () => {
  const { client } = await createTestDb();
  const hostUrl = new URL(client.options.connectionString!);
  // The same database, as the container itself reaches it.
  containerUrl = `postgres://postgres@localhost:5432${hostUrl.pathname}`;
});

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "cvm-dump-"));
const mode = (file: string) => fs.statSync(file).mode & 0o777;

describe.skipIf(Boolean(process.env.CVM_TEST_DATABASE_URL))("writeDump", () => {
  it("writes a 0600 custom-format dump that pg_restore can read", async () => {
    const dir = path.join(tmpDir(), "cvm");
    const { file } = await writeDump({
      url: containerUrl,
      serverMajor: 17,
      dir,
      keep: 14,
      now: new Date("2026-11-03T03:17:00Z"),
      pgDump: PG_DUMP,
    });

    expect(path.basename(file)).toBe("cvm-20261103T031700Z.dump");
    expect(mode(file)).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
    const listing = execFileSync(
      "docker",
      ["exec", "-i", CONTAINER, "pg_restore", "--list"],
      { input: fs.readFileSync(file), encoding: "utf8" }
    );
    expect(listing).toContain("course-video-manager_video");
    expect(fs.readdirSync(dir)).toEqual(["cvm-20261103T031700Z.dump"]);
  });

  it("keeps the newest 14 dumps and leaves other files alone", async () => {
    const dir = tmpDir();
    for (let day = 1; day <= 15; day++) {
      const d = String(day).padStart(2, "0");
      fs.writeFileSync(path.join(dir, `cvm-202610${d}T031700Z.dump`), "old");
    }
    fs.writeFileSync(path.join(dir, "dump.log"), "log");

    const { file, removed } = await writeDump({
      url: containerUrl,
      serverMajor: 17,
      dir,
      keep: 14,
      now: new Date("2026-11-03T03:17:00Z"),
      pgDump: PG_DUMP,
    });

    expect(removed).toEqual([
      "cvm-20261001T031700Z.dump",
      "cvm-20261002T031700Z.dump",
    ]);
    const left = fs.readdirSync(dir).filter((f) => f.endsWith(".dump"));
    expect(left).toHaveLength(14);
    expect(left).toContain(path.basename(file));
    expect(fs.existsSync(path.join(dir, "dump.log"))).toBe(true);
  });

  it("refuses a pg_dump older than the server, before writing anything", async () => {
    const dir = tmpDir();
    const error = await writeDump({
      url: containerUrl,
      serverMajor: 99,
      dir,
      keep: 14,
      now: new Date(),
      pgDump: PG_DUMP,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DumpError);
    expect((error as Error).message).toContain(
      "pg_dump is version 17 but the server is 99"
    );
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("leaves no file behind, and prunes nothing, when pg_dump fails", async () => {
    const dir = tmpDir();
    const old = path.join(dir, "cvm-20261001T031700Z.dump");
    fs.writeFileSync(old, "old");

    await expect(
      writeDump({
        url: "postgres://postgres@localhost:5432/no_such_database_cvm",
        serverMajor: 17,
        dir,
        keep: 0,
        now: new Date("2026-11-03T03:17:00Z"),
        pgDump: PG_DUMP,
      })
    ).rejects.toThrow("pg_dump exited with");
    expect(fs.readdirSync(dir)).toEqual([path.basename(old)]);
  });
});

describe("pgEnvFromUrl", () => {
  it("carries the credentials and TLS settings as libpq variables", () => {
    expect(
      pgEnvFromUrl(
        "postgresql://user%40x:p%2Fss@db.example.com:6432/app?sslmode=verify-full"
      )
    ).toEqual({
      PGHOST: "db.example.com",
      PGPORT: "6432",
      PGUSER: "user@x",
      PGPASSWORD: "p/ss",
      PGDATABASE: "app",
      PGSSLMODE: "verify-full",
    });
  });

  it("refuses a parameter it cannot pass on, naming it without its value", () => {
    expect(() =>
      pgEnvFromUrl("postgresql://u:secretpw@h/db?weird=secretparam")
    ).toThrow("'weird'");
    try {
      pgEnvFromUrl("postgresql://u:secretpw@h/db?weird=secretparam");
    } catch (e) {
      expect((e as Error).message).not.toMatch(/secret/);
    }
  });
});
