import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import { eq, getTableColumns } from "drizzle-orm";

let testDb: TestDb;
let testLayer: Layer.Layer<CourseOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = CourseOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, CourseOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

describe("duplicateCourse — schema-drift guard", () => {
  const COPY_SPEC = {
    section: {
      table: schema.sections,
      copied: ["title", "description", "order"],
      notCopied: [
        "id",
        "repoVersionId",
        "previousVersionSectionId",
        "lineageId",
        "archivedAt",
        "createdAt",
      ],
    },
    lesson: {
      table: schema.lessons,
      copied: [
        "title",
        "description",
        "icon",
        "priority",
        "dependencies",
        "authoringStatus",
        "order",
      ],
      notCopied: [
        "id",
        "sectionId",
        "previousVersionLessonId",
        "lineageId",
        "archived",
        "createdAt",
      ],
    },
    video: {
      table: schema.videos,
      copied: ["title", "originalFootagePath", "body", "description", "format"],
      notCopied: [
        "id",
        "lessonId",
        "pitchId",
        "lineageId",
        "archived",
        "createdAt",
        "updatedAt",
      ],
    },
    clip: {
      table: schema.clips,
      copied: [
        "videoFilename",
        "sourceStartTime",
        "sourceEndTime",
        "order",
        "text",
        "transcribedAt",
        "scene",
        "profile",
        "pauseType",
        "diagramSnapshotId",
      ],
      notCopied: ["id", "videoId", "archived", "createdAt"],
    },
    chapter: {
      table: schema.chapters,
      copied: ["name", "order"],
      notCopied: ["id", "videoId", "archived", "createdAt"],
    },
    beat: {
      table: schema.beats,
      copied: ["kind", "title", "description", "order"],
      notCopied: ["id", "videoId", "archived", "createdAt"],
    },
    thumbnail: {
      table: schema.thumbnails,
      copied: ["layers", "filePath", "selectedForUpload"],
      notCopied: ["id", "videoId", "createdAt"],
    },
  } as const;

  async function getOne(table: any, column: string, value: string) {
    const rows = await testDb
      .select()
      .from(table)
      .where(eq(table[column], value));
    return rows[0];
  }

  it("declares every column of every copied table (add a column => this fails)", () => {
    for (const [name, spec] of Object.entries(COPY_SPEC)) {
      const actual = Object.keys(getTableColumns(spec.table)).sort();
      const declared = [...spec.copied, ...spec.notCopied].sort();
      expect(actual, `uncategorized column(s) on "${name}"`).toEqual(declared);
    }
  });

  it("carries over every copied column end-to-end", async () => {
    const [diagram] = await testDb
      .insert(schema.diagrams)
      .values({ name: "Coverage Diagram" })
      .returning();
    const [snapshot] = await testDb
      .insert(schema.diagramSnapshots)
      .values({
        diagramId: diagram!.id,
        scene: { nodes: [] },
        contentHash: "coverage-hash",
      })
      .returning();

    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Coverage Source", memory: "cov memory" })
      .returning();
    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "vSrc", description: "version desc" })
      .returning();
    const [section] = await testDb
      .insert(schema.sections)
      .values({
        repoVersionId: version!.id,
        title: "Coverage Section",
        description: "Section Description",
        order: 3,
        previousVersionSectionId: "old-section-id",
      })
      .returning();
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        title: "Coverage Lesson",
        description: "Lesson Description",
        icon: "rocket",
        priority: 5,
        dependencies: ["dep-a", "dep-b"],
        authoringStatus: "in-progress",
        order: 7,
        previousVersionLessonId: "old-lesson-id",
      })
      .returning();
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "coverage.mp4",
        originalFootagePath: "/footage/coverage.mp4",
        body: "video body content",
        description: "video SEO description",
      })
      .returning();
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: "coverage-clip.mp4",
      sourceStartTime: 1.5,
      sourceEndTime: 9.5,
      order: "m",
      text: "clip text",
      transcribedAt: new Date("2026-01-01T00:00:00.000Z"),
      scene: "scene-1",
      profile: "profile-1",
      pauseType: "intro",
      diagramSnapshotId: snapshot!.id,
    });
    await testDb.insert(schema.chapters).values({
      videoId: video!.id,
      name: "Coverage Chapter",
      order: "m",
    });
    await testDb.insert(schema.beats).values({
      videoId: video!.id,
      kind: "quest",
      title: "Coverage Beat",
      description: "Beat Description",
      order: "m",
    });
    await testDb.insert(schema.thumbnails).values({
      videoId: video!.id,
      layers: [{ type: "text", content: "coverage" }],
      filePath: "/thumbs/coverage.png",
      selectedForUpload: true,
    });

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course!.id,
          name: "Coverage Dup",
        });
      })
    );

    const [dupTree] = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: {
        lessons: {
          with: {
            videos: {
              with: {
                clips: true,
                chapters: true,
                beats: true,
                thumbnails: true,
              },
            },
          },
        },
      },
    });

    const dupVideo = dupTree!.lessons[0]!.videos[0]!;
    const dupRows: Record<keyof typeof COPY_SPEC, any> = {
      section: dupTree!,
      lesson: dupTree!.lessons[0]!,
      video: dupVideo,
      clip: dupVideo.clips[0]!,
      chapter: dupVideo.chapters[0]!,
      beat: dupVideo.beats[0]!,
      thumbnail: dupVideo.thumbnails[0]!,
    };
    const sourceRows: Record<keyof typeof COPY_SPEC, any> = {
      section: section!,
      lesson: lesson!,
      video: video!,
      clip: await getOne(schema.clips, "videoId", video!.id),
      chapter: await getOne(schema.chapters, "videoId", video!.id),
      beat: await getOne(schema.beats, "videoId", video!.id),
      thumbnail: await getOne(schema.thumbnails, "videoId", video!.id),
    };

    for (const [name, spec] of Object.entries(COPY_SPEC)) {
      const src = sourceRows[name as keyof typeof COPY_SPEC];
      const dup = dupRows[name as keyof typeof COPY_SPEC];
      for (const col of spec.copied) {
        expect(dup[col], `"${name}.${col}" was not carried over`).toEqual(
          src[col]
        );
      }
    }
  });
});
