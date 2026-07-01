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
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm WRITE verbs — pitch create/update + segment add --pitch
// (Split from cli-integration.test.ts to stay under the per-file token budget.)
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

describe("pitch create / update", () => {
  interface Pitch {
    id: string;
    title: string;
    description: string;
    contentPlan: string;
    youtubeTitle: string;
    youtubeThumbnailDescription: string;
    newsletterTitle: string;
    tweet: string;
    priority: number;
    effort: number;
    archived: boolean;
  }
  const pobj = (stdout: string): Pitch => one<Pitch>(stdout);

  it("create --title makes a titled pitch that appears in list", async () => {
    const { stdout, stderr, exitCode } = await run([
      "pitch",
      "create",
      "--title",
      "Effect for React devs",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const p = pobj(stdout);
    expect(p.title).toBe("Effect for React devs");
    expect(p.archived).toBe(false);
    const list = ndjson((await run(["pitch", "list"])).stdout) as Pitch[];
    expect(list.map((x) => x.id)).toContain(p.id);
  });

  it("create accepts the full copy + ranking field set", async () => {
    const p = pobj(
      (
        await run([
          "pitch",
          "create",
          "--title",
          "Zod v4",
          "--description",
          "d",
          "--content-plan",
          "cp",
          "--youtube-title",
          "yt",
          "--youtube-thumbnail",
          "thumb",
          "--newsletter-title",
          "nl",
          "--tweet",
          "big news",
          "--priority",
          "1",
          "--effort",
          "3",
        ])
      ).stdout
    );
    expect(p.description).toBe("d");
    expect(p.contentPlan).toBe("cp");
    expect(p.youtubeTitle).toBe("yt");
    expect(p.youtubeThumbnailDescription).toBe("thumb");
    expect(p.newsletterTitle).toBe("nl");
    expect(p.tweet).toBe("big news");
    expect(p.priority).toBe(1);
    expect(p.effort).toBe(3);
  });

  it("create with missing --title => invalid input, exit 3", async () => {
    const { exitCode } = await run(["pitch", "create"]);
    expect(exitCode).toBe(3);
  });

  it("create with an empty --title => invalid input, exit 3", async () => {
    const { exitCode, stdout } = await run([
      "pitch",
      "create",
      "--title",
      "  ",
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("update --title renames (patches only what is passed)", async () => {
    const updated = pobj(
      (await run(["pitch", "update", "--title", "Renamed", s.pitchActiveId]))
        .stdout
    );
    expect(updated.id).toBe(s.pitchActiveId);
    expect(updated.title).toBe("Renamed");
  });

  it("update patches priority and effort, leaving title untouched", async () => {
    const updated = pobj(
      (
        await run([
          "pitch",
          "update",
          "--priority",
          "5",
          "--effort",
          "1",
          s.pitchActiveId,
        ])
      ).stdout
    );
    expect(updated.priority).toBe(5);
    expect(updated.effort).toBe(1);
    expect(updated.title).toBe("Active pitch"); // untouched
  });

  it("update with no fields => invalid input, exit 3", async () => {
    const { exitCode, stdout } = await run([
      "pitch",
      "update",
      s.pitchActiveId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("update with an empty --title => invalid input, exit 3", async () => {
    const { exitCode, stdout } = await run([
      "pitch",
      "update",
      "--title",
      "  ",
      s.pitchActiveId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("update an unknown pitch => NotFoundError(pitch), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "pitch",
      "update",
      "--title",
      "x",
      "pit_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "pitch"
    );
  });

  it("update an archived pitch => NotFoundError(pitch), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "pitch",
      "update",
      "--title",
      "x",
      s.pitchArchivedId,
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "pitch"
    );
  });
});

describe("segment add --pitch (resolve-or-create the pitch's video)", () => {
  interface Seg {
    id: string;
    videoId: string;
    kind: string;
    title: string;
  }
  const sobj = (stdout: string): Seg => one<Seg>(stdout);

  it("with 0 videos, auto-creates the pitch's video and adds the segment", async () => {
    const seg = sobj(
      (
        await run([
          "segment",
          "add",
          "--pitch",
          s.pitchActiveId,
          "--kind",
          "quest",
          "--title",
          "Try it",
        ])
      ).stdout
    );
    expect(seg.kind).toBe("quest");
    expect(seg.title).toBe("Try it");
    // The pitch now has exactly one video, carrying that segment.
    const pitch = one<{
      videos: Array<{ id: string; segments: Array<{ id: string }> }>;
    }>((await run(["pitch", "get", s.pitchActiveId])).stdout);
    expect(pitch.videos).toHaveLength(1);
    expect(pitch.videos[0]!.id).toBe(seg.videoId);
    expect(pitch.videos[0]!.segments.map((x) => x.id)).toContain(seg.id);
  });

  it("with exactly 1 video, adds to that video (no new video)", async () => {
    const v = one<{ id: string }>(
      (
        await run([
          "video",
          "create",
          "--name",
          "Cut",
          "--pitch",
          s.pitchActiveId,
        ])
      ).stdout
    );
    const seg = sobj(
      (await run(["segment", "add", "--pitch", s.pitchActiveId])).stdout
    );
    expect(seg.videoId).toBe(v.id);
    const pitch = one<{ videos: unknown[] }>(
      (await run(["pitch", "get", s.pitchActiveId])).stdout
    );
    expect(pitch.videos).toHaveLength(1); // still one video
  });

  it("with >1 videos, is ambiguous => invalid input, exit 3", async () => {
    await run(["video", "create", "--name", "A", "--pitch", s.pitchActiveId]);
    await run(["video", "create", "--name", "B", "--pitch", s.pitchActiveId]);
    const { exitCode, stdout } = await run([
      "segment",
      "add",
      "--pitch",
      s.pitchActiveId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("both --video and --pitch => invalid input, exit 3", async () => {
    const { exitCode } = await run([
      "segment",
      "add",
      "--video",
      s.standaloneActiveId,
      "--pitch",
      s.pitchActiveId,
    ]);
    expect(exitCode).toBe(3);
  });

  it("neither --video nor --pitch => invalid input, exit 3", async () => {
    const { exitCode } = await run(["segment", "add"]);
    expect(exitCode).toBe(3);
  });

  it("unknown pitch => NotFoundError(pitch), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "segment",
      "add",
      "--pitch",
      "pit_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "pitch"
    );
  });

  it("archived pitch => NotFoundError(pitch), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "segment",
      "add",
      "--pitch",
      s.pitchArchivedId,
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "pitch"
    );
  });
});
