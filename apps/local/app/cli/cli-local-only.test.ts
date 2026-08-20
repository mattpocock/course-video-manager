import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  makeRun,
  makeTempVideoFilesDir,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// The local-only commands, refusing.
//
// `cvm file`, `cvm course publish` and `cvm course readiness` need the machine
// rather than the data: the Video Files directory, the finished videos
// directory, ffmpeg. On a Remote Box they can NEVER work, and the difference
// between a refusal and a filesystem error is the difference between an agent
// that stops and an agent that retries — so the refusal is asserted here as
// what an agent actually sees: an exit code, a tag, and a reason.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let videoFiles: ReturnType<typeof makeTempVideoFilesDir>;
let s: WriteSeed;

const previousMarker = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
  videoFiles = makeTempVideoFilesDir();
  // Set explicitly rather than deleted: the author's own repo `.env` says
  // `true`, and a test that only passes on a machine without one is a test
  // that fails for the one person who runs this suite by hand.
  process.env[LOCAL_MACHINE_ENV_KEY] = "false";
});

afterAll(() => {
  videoFiles.cleanup();
  if (previousMarker === undefined) delete process.env[LOCAL_MACHINE_ENV_KEY];
  else process.env[LOCAL_MACHINE_ENV_KEY] = previousMarker;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  nodeFs.rmSync(videoFiles.dir, { recursive: true, force: true });
  nodeFs.mkdirSync(videoFiles.dir, { recursive: true });
});

const failureOf = (result: RunResult) => JSON.parse(result.stderr.trim());

const courseIdOf = async (): Promise<string> => {
  const course = await testDb.query.courses.findFirst();
  return course!.id;
};

describe("on a box that is not the author's", () => {
  it("refuses every cvm file verb", async () => {
    const invocations: ReadonlyArray<ReadonlyArray<string>> = [
      ["file", "list", "--video", s.standaloneActiveId],
      ["file", "add", "--video", s.standaloneActiveId, "/tmp/whatever.md"],
      ["file", "get", "--video", s.standaloneActiveId, "notes.md"],
      ["file", "delete", "--video", s.standaloneActiveId, "notes.md"],
    ];

    for (const argv of invocations) {
      const result = await run(argv);

      expect(result.exitCode, argv.join(" ")).toBe(7);
      expect(failureOf(result)._tag).toBe("LocalOnlyCommandError");
      expect(result.stdout).toBe("");
    }
  });

  it("refuses every cvm footage verb", async () => {
    const invocations: ReadonlyArray<ReadonlyArray<string>> = [
      ["footage", "list"],
      ["footage", "list", "--dir", "/tmp/whatever"],
      ["footage", "transcribe", "/tmp/whatever.mkv"],
      ["footage", "transcript", "/tmp/whatever.mkv"],
    ];

    for (const argv of invocations) {
      const result = await run(argv);

      expect(result.exitCode, argv.join(" ")).toBe(7);
      expect(failureOf(result)._tag).toBe("LocalOnlyCommandError");
      expect(result.stdout).toBe("");
    }
  });

  it("names footage as the resource cvm footage would have needed", async () => {
    const footage = failureOf(await run(["footage", "list"]));
    expect(footage.command).toBe("cvm footage");
    expect(footage.message).toContain("raw footage");
  });

  it("refuses cvm course readiness", async () => {
    const result = await run(["course", "readiness", await courseIdOf()]);

    expect(result.exitCode).toBe(7);
    expect(failureOf(result)._tag).toBe("LocalOnlyCommandError");
    expect(result.stdout).toBe("");
  });

  it("refuses cvm course publish", async () => {
    const result = await run([
      "course",
      "publish",
      "--name",
      "v1.0.0",
      "--description",
      "first cut",
      await courseIdOf(),
    ]);

    expect(result.exitCode).toBe(7);
    expect(failureOf(result)._tag).toBe("LocalOnlyCommandError");
    expect(result.stdout).toBe("");
  });

  it("names the resource it would have needed", async () => {
    // An agent that reads "it reads the finished videos directory" reports
    // accurately why it stopped. One that reads ENOENT tries again.
    const file = failureOf(
      await run(["file", "list", "--video", s.lessonVideoId])
    );
    const readiness = failureOf(
      await run(["course", "readiness", await courseIdOf()])
    );

    expect(file.message).toContain("Video Files directory");
    expect(readiness.message).toContain("finished videos directory");
    expect(file.command).toBe("cvm file");
    expect(readiness.command).toBe("cvm course readiness");
  });

  it("says the machine is the problem, not the input", async () => {
    const result = await run(["file", "list", "--video", s.lessonVideoId]);

    expect(failureOf(result).message).toContain(LOCAL_MACHINE_ENV_KEY);
  });

  it("refuses before doing any work", async () => {
    // The file exists on disk, so a `delete` that got as far as its work would
    // unlink it. A refused command must leave nothing changed.
    const dir = nodePath.join(videoFiles.dir, s.standaloneActiveLineageId);
    nodeFs.mkdirSync(dir, { recursive: true });
    nodeFs.writeFileSync(nodePath.join(dir, "notes.md"), "keep me");

    const result = await run([
      "file",
      "delete",
      "--video",
      s.standaloneActiveId,
      "notes.md",
    ]);

    expect(result.exitCode).toBe(7);
    expect(nodeFs.existsSync(nodePath.join(dir, "notes.md"))).toBe(true);
  });

  it("refuses ahead of the command's own validation", async () => {
    // A malformed --name is normally exit 3. The machine check comes first,
    // because a valid name would not have helped either.
    const result = await run([
      "course",
      "publish",
      "--name",
      "not-a-semver",
      "--description",
      "first cut",
      await courseIdOf(),
    ]);

    expect(result.exitCode).toBe(7);
    expect(failureOf(result)._tag).toBe("LocalOnlyCommandError");
  });

  it("is distinguishable from a not-found", async () => {
    const localOnly = await run(["file", "list", "--video", "video_nope"]);
    const notFound = await run(["video", "get", "video_nope"]);

    expect(failureOf(localOnly)._tag).toBe("LocalOnlyCommandError");
    expect(failureOf(notFound)._tag).toBe("NotFoundError");
    expect(localOnly.exitCode).not.toBe(notFound.exitCode);
  });
});

describe("on the author's machine", () => {
  beforeEach(() => {
    process.env[LOCAL_MACHINE_ENV_KEY] = "true";
  });

  afterAll(() => {
    process.env[LOCAL_MACHINE_ENV_KEY] = "false";
  });

  it("lets the local-only commands through", async () => {
    const result = await run(["file", "list", "--video", s.standaloneActiveId]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});
