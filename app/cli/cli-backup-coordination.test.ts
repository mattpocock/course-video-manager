import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  BackupCoordinator,
  BackupCoordinatorError,
} from "@/cli/backup-coordinator";
import {
  buildWriteLayer,
  makeRun,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// Backup coordination — health-gate before writes, dump-trigger after writes,
// read verbs bypass coordination entirely.
// ===========================================================================

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

// ---------------------------------------------------------------------------
// Unhealthy coordinator — writes must be blocked
// ---------------------------------------------------------------------------

const unhealthyLayer = Layer.succeed(BackupCoordinator, {
  ensureServerHealthy: Effect.fail(
    new BackupCoordinatorError("server unreachable")
  ),
  requestDump: Effect.void,
} as unknown as BackupCoordinator);

describe("unhealthy server blocks writes", () => {
  let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
  beforeAll(() => {
    run = makeRun(buildWriteLayer(testDb, unhealthyLayer));
  });

  it("pitch create is blocked", async () => {
    const { stdout, stderr, exitCode } = await run([
      "pitch",
      "create",
      "--title",
      "Should not be created",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("BackupCoordinatorError");
  });

  it("pitch update is blocked", async () => {
    const { stdout, stderr, exitCode } = await run([
      "pitch",
      "update",
      "--title",
      "New",
      s.pitchActiveId,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("BackupCoordinatorError");
  });

  it("segment add is blocked", async () => {
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "add",
      "--video",
      s.lessonVideoId,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("BackupCoordinatorError");
  });

  it("lesson create is blocked", async () => {
    const { stdout, stderr, exitCode } = await run([
      "lesson",
      "create",
      "--title",
      "Blocked",
      "--section",
      s.draftSectionId,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("BackupCoordinatorError");
  });

  it("video create is blocked", async () => {
    const { stdout, stderr, exitCode } = await run([
      "video",
      "create",
      "--name",
      "blocked.mp4",
      "--lesson",
      s.lessonId,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("BackupCoordinatorError");
  });
});

// ---------------------------------------------------------------------------
// Healthy coordinator — writes succeed, requestDump fires
// ---------------------------------------------------------------------------

describe("healthy server allows writes and fires dump", () => {
  let dumpCount: number;
  let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

  beforeEach(() => {
    dumpCount = 0;
    const trackingLayer = Layer.succeed(BackupCoordinator, {
      ensureServerHealthy: Effect.void,
      requestDump: Effect.sync(() => {
        dumpCount++;
      }),
    } as unknown as BackupCoordinator);
    run = makeRun(buildWriteLayer(testDb, trackingLayer));
  });

  it("pitch create succeeds and fires dump once", async () => {
    const { stdout, exitCode } = await run([
      "pitch",
      "create",
      "--title",
      "Coordinated pitch",
    ]);
    expect(exitCode).toBe(0);
    const p = one<{ title: string }>(stdout);
    expect(p.title).toBe("Coordinated pitch");
    expect(dumpCount).toBe(1);
  });

  it("segment add succeeds and fires dump once", async () => {
    const { stdout, exitCode } = await run([
      "segment",
      "add",
      "--video",
      s.lessonVideoId,
      "--kind",
      "definition",
      "--title",
      "Intro",
    ]);
    expect(exitCode).toBe(0);
    const seg = one<{ title: string; videoId: string }>(stdout);
    expect(seg.title).toBe("Intro");
    expect(seg.videoId).toBe(s.lessonVideoId);
    expect(dumpCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Read verbs bypass coordination — work even with unhealthy coordinator
// ---------------------------------------------------------------------------

describe("read verbs bypass backup coordination", () => {
  let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
  beforeAll(() => {
    run = makeRun(buildWriteLayer(testDb, unhealthyLayer));
  });

  it("pitch list works with unhealthy server", async () => {
    const { exitCode, stderr } = await run(["pitch", "list"]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  it("segment list works with unhealthy server", async () => {
    const { exitCode, stderr } = await run([
      "segment",
      "list",
      "--video",
      s.lessonVideoId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  it("lesson list works with unhealthy server", async () => {
    const { exitCode, stderr } = await run([
      "lesson",
      "list",
      "--section",
      s.draftSectionId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  it("video list works with unhealthy server", async () => {
    const { exitCode, stderr } = await run(["video", "list"]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });
});
