import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";
import { copyVideoImpl } from "./db-video-operations.copy.server.js";
import {
  createCourseAndVersion,
  createLesson,
  createSection,
} from "./path-uniqueness-test-helpers.js";
import type { Database } from "./drizzle-service.server.js";
import { Effect } from "effect";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function createVideo(
  overrides: Partial<typeof schema.videos.$inferInsert> = {}
) {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title: "problem",
      originalFootagePath: "/tmp/problem.mp4",
      ...overrides,
    })
    .returning();
  return video!;
}

async function getVideo(id: string) {
  return testDb.query.videos.findFirst({
    where: (v, { eq }) => eq(v.id, id),
  });
}

const db = () => testDb as unknown as Database;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("copyVideoImpl — renameOld", () => {
  it("renames the source video to '<title> (old)' without archiving it", async () => {
    const source = await createVideo({ title: "problem" });

    const newVideoId = await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "problem",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: true,
      })
    );

    const oldVideo = await getVideo(source.id);
    expect(oldVideo!.title).toBe("problem (old)");
    expect(oldVideo!.archived).toBe(false);

    const newVideo = await getVideo(newVideoId);
    expect(newVideo!.title).toBe("problem");
    expect(newVideo!.archived).toBe(false);
  });

  it("appends (old) suffix even when source already has it", async () => {
    const source = await createVideo({
      title: "problem (old)",
    });

    const newVideoId = await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "problem",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: true,
      })
    );

    const oldVideo = await getVideo(source.id);
    expect(oldVideo!.title).toBe("problem (old) (old)");

    const newVideo = await getVideo(newVideoId);
    expect(newVideo!.title).toBe("problem");
  });

  // The videos above have no lesson, so video_lesson_title_uniq — unique on
  // (lesson_id, title) for non-archived rows — never fires. These cover a
  // video that actually belongs to a lesson.
  async function createLessonId() {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "Section", 0);
    const lesson = await createLesson(testDb, section.id, "Lesson", 0);
    return lesson.id;
  }

  it("copies within a lesson when the new video reuses the source's title", async () => {
    const lessonId = await createLessonId();
    const source = await createVideo({ title: "Explainer", lessonId });

    const newVideoId = await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "Explainer",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: true,
      })
    );

    expect((await getVideo(source.id))!.title).toBe("Explainer (old)");
    expect((await getVideo(newVideoId))!.title).toBe("Explainer");
  });

  it("disambiguates the (old) title when the lesson already has one", async () => {
    const lessonId = await createLessonId();
    await createVideo({ title: "Explainer (old)", lessonId });
    const source = await createVideo({ title: "Explainer", lessonId });

    const newVideoId = await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "Explainer",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: true,
      })
    );

    expect((await getVideo(source.id))!.title).toBe("Explainer (old) (2)");
    expect((await getVideo(newVideoId))!.title).toBe("Explainer");
  });

  it("ignores archived siblings when disambiguating the (old) title", async () => {
    const lessonId = await createLessonId();
    await createVideo({
      title: "Explainer (old)",
      lessonId,
      archived: true,
    });
    const source = await createVideo({ title: "Explainer", lessonId });

    await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "Explainer",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: true,
      })
    );

    expect((await getVideo(source.id))!.title).toBe("Explainer (old)");
  });

  it("does not rename the source when renameOld is false", async () => {
    const source = await createVideo({ title: "problem" });

    await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "problem (copy)",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: false,
      })
    );

    const oldVideo = await getVideo(source.id);
    expect(oldVideo!.title).toBe("problem");
  });
});

describe("copyVideoImpl — copyScript", () => {
  it("copies the source script onto the new video when copyScript is true", async () => {
    const source = await createVideo({
      title: "problem",
      script: "INT. TERMINAL - DAY\n\n[improvise the build]",
    });

    const newVideoId = await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "problem (copy)",
        copyClips: false,
        copyBeats: false,
        copyScript: true,
        renameOld: false,
      })
    );

    const newVideo = await getVideo(newVideoId);
    expect(newVideo!.script).toBe(
      "INT. TERMINAL - DAY\n\n[improvise the build]"
    );
  });

  it("leaves the new video's script null when copyScript is false", async () => {
    const source = await createVideo({
      title: "problem",
      script: "some script",
    });

    const newVideoId = await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "problem (copy)",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: false,
      })
    );

    const newVideo = await getVideo(newVideoId);
    expect(newVideo!.script).toBeNull();
  });
});

describe("copyVideoImpl — clip mockups", () => {
  it("copies clip mockups in order, excluding archived ones, with fresh order keys", async () => {
    const source = await createVideo({ title: "problem" });

    // Inserted out of `order` on purpose, and with one archived row: the copy
    // must follow `order` and drop the archived one.
    await testDb.insert(schema.clipMockups).values([
      {
        videoId: source.id,
        line: "Second line",
        imagePath: "frame-002.png",
        durationSeconds: 3.5,
        order: "a2",
      },
      {
        videoId: source.id,
        line: "First line",
        imagePath: "frame-001.png",
        order: "a1",
      },
      {
        videoId: source.id,
        line: "Archived line",
        imagePath: "frame-003.png",
        order: "a3",
        archived: true,
      },
    ]);

    const newVideoId = await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "problem (copy)",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: false,
      })
    );

    const copied = await testDb.query.clipMockups.findMany({
      where: (m, { eq }) => eq(m.videoId, newVideoId),
      orderBy: (m, { asc }) => asc(m.order),
    });

    expect(
      copied.map((m) => ({
        line: m.line,
        imagePath: m.imagePath,
        durationSeconds: m.durationSeconds,
        archived: m.archived,
      }))
    ).toEqual([
      {
        line: "First line",
        imagePath: "frame-001.png",
        durationSeconds: null,
        archived: false,
      },
      {
        line: "Second line",
        imagePath: "frame-002.png",
        durationSeconds: 3.5,
        archived: false,
      },
    ]);

    // This path regenerates order keys the way it does for clips, chapters and
    // beats — relative order survives, the literal keys do not.
    expect(copied.map((m) => m.order)).not.toEqual(["a1", "a2"]);
  });

  it("leaves the copy with no clip mockups when the source has none", async () => {
    const source = await createVideo({ title: "problem" });

    const newVideoId = await run(
      copyVideoImpl(db(), {
        sourceVideoId: source.id,
        newTitle: "problem (copy)",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: false,
      })
    );

    const copied = await testDb.query.clipMockups.findMany({
      where: (m, { eq }) => eq(m.videoId, newVideoId),
    });
    expect(copied).toEqual([]);
  });
});
