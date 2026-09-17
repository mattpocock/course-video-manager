import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  type RunResult,
} from "./cli-write-test-harness";
import {
  seedIntegration,
  type IntegrationSeed,
} from "./cli-integration-test-harness";

// ===========================================================================
// cvm clip get/list --archived: the REVIEW SURFACE, unlike most other
// archived nouns (which have no --archived listing and no restore verb at
// all — see the "archived filtering" describe block in cli-integration.test.ts
// for those). Split out into its own file per the per-file token budget.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

let s: IntegrationSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedIntegration(testDb);
});

describe("clip get/list --archived", () => {
  it("clip get on an archived clip id => NotFoundError, exit 2 (default hides it)", async () => {
    const { stdout, stderr, exitCode } = await run([
      "clip",
      "get",
      s.archivedClipId,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("clip");
  });

  it("clip get --archived on an archived clip id reveals it", async () => {
    const { stdout, stderr, exitCode } = await run([
      "clip",
      "get",
      "--archived",
      s.archivedClipId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const clip = JSON.parse(stdout) as { id: string; archived: boolean };
    expect(clip.id).toBe(s.archivedClipId);
    expect(clip.archived).toBe(true);
  });

  it("clip list --video defaults to ACTIVE clips only", async () => {
    const rows = ndjson(
      (await run(["clip", "list", "--video", s.lessonVideoId])).stdout
    ) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([s.clip1Id, s.clip2Id]);
  });

  it("clip list --video --archived includes the archived clip too, in timeline position", async () => {
    const rows = ndjson(
      (await run(["clip", "list", "--video", s.lessonVideoId, "--archived"]))
        .stdout
    ) as { id: string; archived: boolean }[];
    expect(rows.map((r) => r.id)).toEqual([
      s.clip1Id,
      s.clip2Id,
      s.archivedClipId,
    ]);
    expect(rows.find((r) => r.id === s.archivedClipId)!.archived).toBe(true);
    expect(rows.find((r) => r.id === s.clip1Id)!.archived).toBe(false);
  });
});
