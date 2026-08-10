import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "@cvm/core/rpc/schema-version";
import type { SchemaVersionClaim } from "./rpc-client";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  makeRun,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// The version gate, seen from where it matters: the CLI.
//
// `cvm` runs from a git checkout on a box that is deployed separately from the
// API. Without this gate an out-of-date checkout writing against a newer schema
// fails as a confusing runtime error — a column that is not there, an argument
// nothing reads — and an agent retries it. With it, the request never reaches a
// service: the deployed app answers with both numbers and the one action that
// fixes it.
// ===========================================================================

let testDb: TestDb;

/** A `cvm` that claims to have been built against `schemaVersion` migrations. */
const runAt = (schemaVersion: SchemaVersionClaim) =>
  makeRun(buildWriteLayer(testDb, { schemaVersion }));

/** The suite's default run(): a CLI from this very checkout. */
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

const failureOf = (result: RunResult) => JSON.parse(result.stderr.trim());

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

let videoId: string;
beforeEach(async () => {
  await truncateAllTables(testDb);
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "intro.mp4", originalFootagePath: "footage.mp4" })
    .returning();
  videoId = video!.id;
});

describe("a CLI built against the API's own schema", () => {
  it("reaches the domain data", async () => {
    const result = await run(["video", "get", videoId]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ title: "intro.mp4" });
  });
});

describe("a CLI built against a different schema", () => {
  it("is refused when its checkout is older", async () => {
    const result = await runAt(SCHEMA_VERSION - 1)(["video", "get", videoId]);

    expect(result.exitCode).toBe(6);
    expect(failureOf(result)._tag).toBe("SchemaVersionMismatchError");
    expect(result.stdout).toBe("");
  });

  it("is refused when its checkout is newer", async () => {
    const result = await runAt(SCHEMA_VERSION + 1)(["video", "get", videoId]);

    expect(result.exitCode).toBe(6);
    expect(failureOf(result)._tag).toBe("SchemaVersionMismatchError");
  });

  it("is refused when it states no version at all", async () => {
    const result = await runAt("unstated")(["video", "get", videoId]);

    expect(result.exitCode).toBe(6);
    expect(failureOf(result)._tag).toBe("SchemaVersionMismatchError");
  });

  it("names both numbers and says to pull", async () => {
    // An agent that reads this fixes it without asking a human, which is the
    // whole reason the gate exists rather than a 500 somewhere downstream.
    const result = await runAt(SCHEMA_VERSION - 1)(["video", "get", videoId]);
    const failure = failureOf(result);

    expect(failure.message).toContain(String(SCHEMA_VERSION - 1));
    expect(failure.message).toContain(String(SCHEMA_VERSION));
    expect(failure.message).toContain("pull");
    expect(failure.cliVersion).toBe(SCHEMA_VERSION - 1);
    expect(failure.apiVersion).toBe(SCHEMA_VERSION);
  });

  it("is distinguishable from a domain error", async () => {
    const mismatch = await runAt(SCHEMA_VERSION - 1)([
      "video",
      "get",
      "video_does_not_exist",
    ]);
    const domainFailure = await run(["video", "get", "video_does_not_exist"]);

    expect(failureOf(mismatch)._tag).toBe("SchemaVersionMismatchError");
    expect(failureOf(domainFailure)._tag).toBe("NotFoundError");
    expect(mismatch.exitCode).not.toBe(domainFailure.exitCode);
  });

  it("writes nothing — the request is refused, not attempted", async () => {
    const result = await runAt(SCHEMA_VERSION - 1)([
      "video",
      "update",
      "--name",
      "renamed.mp4",
      videoId,
    ]);

    expect(result.exitCode).toBe(6);
    const [row] = await testDb.select().from(schema.videos);
    expect(row!.title).toBe("intro.mp4");
  });
});
