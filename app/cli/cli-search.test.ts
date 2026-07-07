import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
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
// cvm search — global and scoped substring search
// (Split from cli-integration.test.ts to stay under the per-file token budget.)
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

  it("title beats transcript for a video's field label", async () => {
    const { stdout } = await run(["search", "intro"]);
    const hits = ndjson(stdout) as any[];
    const video = hits.find((h) => h.kind === "video");
    expect(video).toMatchObject({ id: s.lessonVideoId, field: "title" });
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

  it("--type narrows result kinds", async () => {
    const only = await run(["search", "--type", "course", "alpha"]);
    expect((ndjson(only.stdout) as any[]).map((h) => h.kind)).toEqual([
      "course",
    ]);
    const none = await run(["search", "--type", "video", "alpha"]);
    expect(none.exitCode).toBe(0);
    expect(none.stdout).toBe("");
  });

  it("empty / whitespace query => exit 3 ParseError", async () => {
    for (const q of ["", "   "]) {
      const { stderr, exitCode } = await run(["search", q]);
      expect(exitCode).toBe(3);
      expect(JSON.parse(stderr)._tag).toBe("ParseError");
    }
  });

  it("unknown --type => exit 3 ParseError", async () => {
    const { stderr, exitCode } = await run(["search", "--type", "bogus", "x"]);
    expect(exitCode).toBe(3);
    expect(JSON.parse(stderr)._tag).toBe("ParseError");
  });

  it("no matches => no output, exit 0", async () => {
    const { stdout, stderr, exitCode } = await run(["search", "zzz-nomatch"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  describe("scoped: course / section / lesson", () => {
    it("course search confines the walk to that course's subtree", async () => {
      const { stdout } = await run(["course", "search", s.courseAId, "intro"]);
      const hits = ndjson(stdout) as any[];
      expect(hits.map((h) => h.kind)).toEqual(["section", "video"]);
    });

    it("section search includes the root section and its descendants", async () => {
      const { stdout } = await run([
        "section",
        "search",
        s.draftSectionId,
        "intro",
      ]);
      const hits = ndjson(stdout) as any[];
      expect(hits.map((h) => h.kind)).toEqual(["section", "video"]);
    });

    it("section search cannot reach the course above it", async () => {
      const { stdout, exitCode } = await run([
        "section",
        "search",
        s.draftSectionId,
        "alpha",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    });

    it("lesson search finds a transcript hit in its subtree", async () => {
      const { stdout } = await run(["lesson", "search", s.lessonId, "hello"]);
      const hits = ndjson(stdout) as any[];
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ kind: "video", id: s.lessonVideoId });
    });

    it("rejects an out-of-scope --type (exit 3)", async () => {
      const { stderr, exitCode } = await run([
        "lesson",
        "search",
        "--type",
        "section",
        s.lessonId,
        "x",
      ]);
      expect(exitCode).toBe(3);
      expect(JSON.parse(stderr)._tag).toBe("ParseError");
    });

    it("rejects --type pitch under a course (exit 3)", async () => {
      const { exitCode, stderr } = await run([
        "course",
        "search",
        "--type",
        "pitch",
        s.courseAId,
        "x",
      ]);
      expect(exitCode).toBe(3);
      expect(JSON.parse(stderr)._tag).toBe("ParseError");
    });

    it("unknown scope id => exit 2 NotFoundError", async () => {
      const { stderr, exitCode } = await run([
        "course",
        "search",
        "does-not-exist",
        "x",
      ]);
      expect(exitCode).toBe(2);
      const err = JSON.parse(stderr);
      expect(err._tag).toBe("NotFoundError");
      expect(err.entity).toBe("course");
    });

    it("archived scope root => exit 2 NotFoundError", async () => {
      const { exitCode } = await run([
        "course",
        "search",
        s.courseBArchivedId,
        "x",
      ]);
      expect(exitCode).toBe(2);
    });

    it("archived section root => exit 2 NotFoundError", async () => {
      const { stderr, exitCode } = await run([
        "section",
        "search",
        s.archivedSectionId,
        "x",
      ]);
      expect(exitCode).toBe(2);
      const err = JSON.parse(stderr);
      expect(err._tag).toBe("NotFoundError");
      expect(err.entity).toBe("section");
    });

    it("archived lesson root => exit 2 NotFoundError", async () => {
      const { stderr, exitCode } = await run([
        "lesson",
        "search",
        s.archivedLessonId,
        "x",
      ]);
      expect(exitCode).toBe(2);
      const err = JSON.parse(stderr);
      expect(err._tag).toBe("NotFoundError");
      expect(err.entity).toBe("lesson");
    });
  });

  describe("literal matching: SQL wildcards are escaped", () => {
    it("treats % and _ as literals in a transcript search", async () => {
      await testDb.insert(schema.clips).values({
        videoId: s.lessonVideoId,
        videoFilename: "pct.mp4",
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
