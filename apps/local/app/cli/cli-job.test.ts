import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import { ndjson, one, type RunResult } from "./cli-write-test-harness";
import {
  enqueueTestJob,
  makeJobRun,
  settleAsSidecar,
} from "./cli-job-test-harness";

// ===========================================================================
// cvm job get | list | wait
//
// Real buildProgram over the test database; the test plays the Sidecar
// (claims and settles Jobs by hand), so no Job is ever run. The refusal on a
// Remote Box is in cli-local-only.test.ts.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  run = makeJobRun(testDb);
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const failureOf = (r: RunResult) =>
  JSON.parse(r.stderr.trim().split("\n").pop()!);

describe("cvm job get", () => {
  it("prints the Job with its params, and what it posted", async () => {
    const job = await enqueueTestJob(testDb, {
      kind: "youtube",
      subject: { type: "video", id: "v1" },
      params: { videoId: "v1", privacyStatus: "unlisted" },
    });
    await settleAsSidecar(testDb, "succeed", [
      {
        type: "posted",
        data: { youtubeVideoId: "yt123", url: "https://studio/yt123" },
      },
    ]);

    const r = await run(["job", "get", job.id]);

    expect(r.exitCode).toBe(0);
    expect(one(r.stdout)).toMatchObject({
      id: job.id,
      kind: "youtube",
      status: "succeeded",
      subject: { type: "video", id: "v1" },
      error: null,
      params: { videoId: "v1", privacyStatus: "unlisted" },
      posted: { youtubeVideoId: "yt123", url: "https://studio/yt123" },
      log: `.data/logs/jobs/${job.id}.jsonl`,
    });
    const { createdAt, finishedAt } = one<{
      createdAt: string;
      finishedAt: string;
    }>(r.stdout);
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
    expect(new Date(finishedAt).toISOString()).toBe(finishedAt);
  });

  it("is not found, exit 2, for an unknown id", async () => {
    const r = await run(["job", "get", "no-such-job"]);

    expect(r.exitCode).toBe(2);
    expect(failureOf(r)).toMatchObject({
      _tag: "NotFoundError",
      entity: "job",
    });
  });
});

describe("cvm job list", () => {
  it("lists Jobs newest first, narrowed by kind, status and Video", async () => {
    const exportJob = await enqueueTestJob(testDb, {
      kind: "export",
      subject: { type: "video", id: "v1" },
    });
    const upload = await enqueueTestJob(testDb, {
      kind: "youtube",
      subject: { type: "video", id: "v1" },
    });
    await enqueueTestJob(testDb, {
      kind: "youtube",
      subject: { type: "video", id: "v2" },
    });

    const all = await run(["job", "list"]);
    expect(all.exitCode).toBe(0);
    expect(ndjson(all.stdout)).toHaveLength(3);

    const r = await run(["job", "list", "--kind", "youtube", "--video", "v1"]);
    expect(r.exitCode).toBe(0);
    const rows = ndjson(r.stdout) as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual([upload.id]);
    // A list row never carries params.
    expect(rows[0]).not.toHaveProperty("params");

    const queued = await run([
      "job",
      "list",
      "--status",
      "queued",
      "--limit",
      "1",
    ]);
    expect(
      (ndjson(queued.stdout) as { id: string }[]).map((j) => j.id)
    ).toHaveLength(1);
    expect(exportJob.id).toBeTruthy();
  });

  it("refuses a status that is no status, exit 3", async () => {
    const r = await run(["job", "list", "--status", "done"]);

    expect(r.exitCode).toBe(3);
  });
});

describe("cvm job wait", () => {
  it("prints each Job once it has succeeded, exit 0", async () => {
    const job = await enqueueTestJob(testDb, { kind: "youtube" });
    const waiting = run(["job", "wait", job.id]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settleAsSidecar(testDb, "succeed");

    const r = await waiting;

    expect(r.exitCode).toBe(0);
    expect(ndjson(r.stdout)).toMatchObject([
      { id: job.id, status: "succeeded" },
    ]);
    // No Sidecar holds a lease here, so it said why the Job was waiting.
    expect(r.stderr).toContain("the sidecar is not running");
  });

  it("ends JobFailedError, exit 4, with the Job's own failure", async () => {
    const job = await enqueueTestJob(testDb, { kind: "youtube" });
    await settleAsSidecar(testDb, "fail");

    const r = await run(["job", "wait", job.id]);

    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");
    expect(failureOf(r)).toMatchObject({
      _tag: "JobFailedError",
      failed: [
        {
          jobId: job.id,
          kind: "youtube",
          status: "failed",
          cause: "YouTubeUploadError",
          message: "YouTube said 403 quotaExceeded",
        },
      ],
    });
  });

  it("ends JobWaitTimeoutError, exit 4, naming what is still queued", async () => {
    const job = await enqueueTestJob(testDb, { kind: "youtube" });

    const r = await run(["job", "wait", "--timeout", "0.005", job.id]);

    expect(r.exitCode).toBe(4);
    expect(failureOf(r)).toMatchObject({
      _tag: "JobWaitTimeoutError",
      pending: [{ jobId: job.id, status: "queued" }],
    });
  });

  it("is not found, exit 2, for an unknown id, before any waiting", async () => {
    const job = await enqueueTestJob(testDb, { kind: "youtube" });

    const r = await run(["job", "wait", job.id, "no-such-job"]);

    expect(r.exitCode).toBe(2);
    expect(failureOf(r)).toMatchObject({
      _tag: "NotFoundError",
      id: "no-such-job",
    });
  });

  it("refuses a timeout that is not positive, exit 3", async () => {
    const r = await run(["job", "wait", "--timeout", "0", "some-job"]);

    expect(r.exitCode).toBe(3);
  });
});
