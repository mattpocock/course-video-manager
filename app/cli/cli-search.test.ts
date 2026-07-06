import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import {
  buildReadLayer,
  makeReadRun,
  ndjson,
  seedRead,
  type ReadSeed,
  type RunResult,
} from "./cli-read-test-harness";

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeReadRun(buildReadLayer(testDb));
});

let s: ReadSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedRead(testDb);
});

describe("search", () => {
  it("matches a course by name, case-insensitively", async () => {
    const { stdout, stderr, exitCode } = await run(["search", "alpha"]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "course",
      id: s.courseAId,
      courseId: s.courseAId,
      name: "Alpha",
      field: "name",
    });
  });

  it("matches a video's transcript (clip text) and returns the VIDEO", async () => {
    const { stdout, exitCode } = await run(["search", "hello"]);
    expect(exitCode).toBe(0);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "video",
      id: s.lessonVideoId,
      lessonId: s.lessonId,
      courseId: s.courseAId,
      field: "transcript",
    });
    expect(hits[0].snippet).toContain("hello");
  });

  it("matches a video's transcript via a chapter name", async () => {
    const { stdout } = await run(["search", "Chapter One"]);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "video",
      id: s.lessonVideoId,
      field: "transcript",
    });
  });

  it("path beats transcript for a video's field label", async () => {
    const { stdout } = await run(["search", "intro"]);
    const hits = ndjson(stdout) as any[];
    const video = hits.find((h) => h.kind === "video");
    expect(video).toMatchObject({ id: s.lessonVideoId, field: "path" });
  });

  it("streams hits in depth-first tree order, one per entity", async () => {
    const { stdout } = await run(["search", "intro"]);
    const hits = ndjson(stdout) as any[];
    expect(hits.map((h) => h.kind)).toEqual(["section", "video"]);
    expect(hits[0].id).toBe(s.draftSectionId);
    expect(hits[1].id).toBe(s.lessonVideoId);
  });

  it("matches an active beat but excludes archived beats", async () => {
    const { stdout } = await run(["search", "beat"]);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "beat", title: "Active beat" });
  });

  it("matches an active pitch (top-level only) and excludes archived pitches", async () => {
    const { stdout } = await run(["search", "pitch"]);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "pitch", id: s.pitchActiveId });
  });

  it("never returns archived clips / lessons / sections", async () => {
    const { stdout, exitCode } = await run(["search", "deleted"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("searches the Draft version only (published-version section excluded)", async () => {
    const { stdout, exitCode } = await run(["search", "00-old"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("no match returns empty output and exit 0", async () => {
    const { stdout, stderr, exitCode } = await run([
      "search",
      "zzz-never-matches",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("matches a lesson by title", async () => {
    const { stdout } = await run(["search", "Welcome"]);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "lesson",
      id: s.lessonId,
    });
  });

  it("matches a section by path", async () => {
    const { stdout } = await run(["search", "01-intro"]);
    const hits = ndjson(stdout) as any[];
    expect(hits.some((h) => h.kind === "section")).toBe(true);
    expect(hits.find((h) => h.kind === "section")).toMatchObject({
      id: s.draftSectionId,
      field: "path",
    });
  });

  it("--kind filters results to only that entity type", async () => {
    const { stdout } = await run(["search", "--kind", "course", "alpha"]);
    const hits = ndjson(stdout) as any[];
    expect(hits.every((h) => h.kind === "course")).toBe(true);
  });

  it("--kind with an unrecognized type => exit 3 ParseError", async () => {
    const { exitCode, stderr } = await run([
      "search",
      "--kind",
      "bogus",
      "alpha",
    ]);
    expect(exitCode).toBe(3);
    const err = JSON.parse(stderr.trim()) as { _tag: string };
    expect(err._tag).toBe("ParseError");
  });

  describe("LIKE / ILIKE edge cases", () => {
    it("literal % and _ in the query are escaped (not treated as SQL wildcards)", async () => {
      await testDb.insert(schema.clips).values({
        videoId: s.lessonVideoId,
        videoFilename: "d.mp4",
        sourceStartTime: 30,
        sourceEndTime: 40,
        order: "0005",
        text: "save 50% today",
      });

      const literal = await run(["search", "50%"]);
      const litHits = ndjson(literal.stdout) as any[];
      expect(litHits.some((h) => h.kind === "video")).toBe(true);

      const escaped = await run(["search", "50_"]);
      expect(escaped.stdout).toBe("");
    });
  });

  describe("snippet windowing", () => {
    it("excerpts a long transcript with ellipses around the match", async () => {
      const long = `${"lorem ipsum ".repeat(20)}NEEDLE${" dolor sit ".repeat(20)}`;
      await testDb.insert(schema.clips).values({
        videoId: s.lessonVideoId,
        videoFilename: "long.mp4",
        sourceStartTime: 40,
        sourceEndTime: 50,
        order: "0006",
        text: long,
      });

      const { stdout } = await run(["search", "NEEDLE"]);
      const hit = (ndjson(stdout) as any[]).find(
        (h) => h.kind === "video" && h.field === "transcript"
      );
      expect(hit.snippet).toContain("NEEDLE");
      expect(hit.snippet.startsWith("…")).toBe(true);
      expect(hit.snippet.endsWith("…")).toBe(true);
      expect(hit.snippet.length).toBeLessThan(long.length);
    });

    it("locates a match whose query contains a run of whitespace", async () => {
      const text = `${"pad ".repeat(30)}alpha  beta ${"tail ".repeat(30)}`;
      await testDb.insert(schema.clips).values({
        videoId: s.lessonVideoId,
        videoFilename: "spaced.mp4",
        sourceStartTime: 50,
        sourceEndTime: 60,
        order: "0007",
        text,
      });

      const { stdout } = await run(["search", "alpha  beta"]);
      const hit = (ndjson(stdout) as any[]).find(
        (h) => h.kind === "video" && h.field === "transcript"
      );
      expect(hit.snippet).toContain("alpha beta");
      expect(hit.snippet.startsWith("…")).toBe(true);
    });
  });
});
