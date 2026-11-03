import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackupFirstMigrateError,
  backupThenMigrate,
  type BackupThenMigrateOptions,
} from "./planetscale-backup.js";

const TOKEN = "pscale_tkn_id123:pscale_tkn_SECRETVALUE";
const TARGET = { organization: "org", database: "cvm", branch: "main" };
const BACKUPS = "/v1/organizations/org/databases/cvm/branches/main/backups";

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(r)))
  );
});

/** A loopback PlanetScale: `create` answers the POST, `states` the GETs in turn. */
const fakePlanetScale = async (api: {
  readonly create: { status: number; body: unknown };
  readonly states?: readonly string[];
}) => {
  const seen: Seen[] = [];
  let polls = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body,
      });
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.method === "POST" && req.url === BACKUPS) {
        return reply(api.create.status, api.create.body);
      }
      if (req.method === "GET" && req.url === `${BACKUPS}/bk_1`) {
        const states = api.states ?? [];
        const state = states[Math.min(polls++, states.length - 1)];
        return reply(200, { id: "bk_1", state });
      }
      reply(404, { code: "not_found" });
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { apiBase: `http://127.0.0.1:${port}/v1`, seen };
};

const run = (
  apiBase: string,
  overrides: Partial<BackupThenMigrateOptions> = {}
) => {
  const lines: string[] = [];
  const events: string[] = [];
  const result = backupThenMigrate({
    apiBase,
    authorization: TOKEN,
    target: TARGET,
    backupName: "pre-migrate-0050",
    retentionDays: 30,
    pollIntervalMs: 5,
    timeoutMs: 2_000,
    log: (line) => lines.push(line),
    migrate: async () => {
      events.push("migrate");
    },
    ...overrides,
  });
  return { result, lines, events };
};

describe("backupThenMigrate", () => {
  it("migrates only after the backup reaches success, and prints its ID and a restore hint", async () => {
    const api = await fakePlanetScale({
      create: { status: 201, body: { id: "bk_1", state: "pending" } },
      states: ["running", "running", "success"],
    });
    const { result, lines, events } = run(api.apiBase);

    await expect(result).resolves.toEqual({ backupId: "bk_1" });
    expect(events).toEqual(["migrate"]);
    // Three polls, then the migrate — never before `success`.
    expect(api.seen.map((s) => s.method)).toEqual([
      "POST",
      "GET",
      "GET",
      "GET",
    ]);
    expect(JSON.parse(api.seen[0]!.body)).toEqual({
      name: "pre-migrate-0050",
      retention_unit: "day",
      retention_value: 30,
    });
    expect(api.seen.every((s) => s.authorization === TOKEN)).toBe(true);
    expect(lines).toContain("Backup ready: bk_1");
    expect(lines.join("\n")).toContain(
      "pscale backup restore cvm <new-branch-name> bk_1 --org org"
    );
    expect(lines.join("\n")).not.toContain("SECRETVALUE");
  });

  it("does not migrate when PlanetScale refuses to create the backup, and never echoes the body", async () => {
    const api = await fakePlanetScale({
      create: {
        status: 403,
        body: { code: "forbidden", message: `echo ${TOKEN}` },
      },
    });
    const { result, events } = run(api.apiBase);

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupFirstMigrateError);
    expect((error as Error).message).toContain("HTTP 403 (forbidden)");
    expect((error as Error).message).not.toContain("SECRETVALUE");
    expect(events).toEqual([]);
  });

  it("does not migrate when the backup ends in a failed state", async () => {
    const api = await fakePlanetScale({
      create: { status: 201, body: { id: "bk_1", state: "pending" } },
      states: ["running", "failed"],
    });
    const { result, events } = run(api.apiBase);

    await expect(result).rejects.toThrow("ended in state 'failed'");
    expect(events).toEqual([]);
  });

  it("does not migrate when the backup never becomes ready", async () => {
    const api = await fakePlanetScale({
      create: { status: 201, body: { id: "bk_1", state: "pending" } },
      states: ["running"],
    });
    const { result, events } = run(api.apiBase, { timeoutMs: 100 });

    await expect(result).rejects.toThrow("was still 'running' after");
    expect(events).toEqual([]);
  });

  it("does not migrate when the API cannot be reached", async () => {
    const api = await fakePlanetScale({ create: { status: 201, body: {} } });
    await new Promise((r) => servers.pop()!.close(r));
    const { result, events } = run(api.apiBase);

    await expect(result).rejects.toThrow("Could not reach the PlanetScale API");
    expect(events).toEqual([]);
  });
});
