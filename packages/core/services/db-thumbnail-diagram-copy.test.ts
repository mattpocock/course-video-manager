import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";
import * as schema from "../db/schema.js";

/**
 * A copied Video's Thumbnails keep their Thumbnail Diagrams and record the
 * originals as their source (ADR 0060), through both copies that carry
 * Thumbnails: Submit and Duplicate Course.
 */

let testDb: TestDb;
let testLayer: Layer.Layer<CourseOperationsService | VersionOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  testLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VersionOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(
  eff: Effect.Effect<A, E, CourseOperationsService | VersionOperationsService>
) => Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

const drawing = {
  store: { "shape:box": { id: "shape:box", typeName: "shape", type: "text" } },
  schema: { schemaVersion: 2, sequences: {} },
};

const inserted = {
  kind: "diagram-component",
  diagramComponentId: "component-1",
} as const;

async function createVideoWithThumbnails() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, order: 1, title: "Lesson" })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "video-01.mp4",
      originalFootagePath: "/footage/raw-01.mp4",
    })
    .returning();
  const layers = { backgroundPhoto: null, diagram: null, cutout: null };
  const [drawn] = await testDb
    .insert(schema.thumbnails)
    .values({
      videoId: video!.id,
      layers,
      filePath: null,
      thumbnailDiagram: drawing,
      diagramSources: [inserted],
    })
    .returning();
  const [pasted] = await testDb
    .insert(schema.thumbnails)
    .values({ videoId: video!.id, layers, filePath: "/pasted.png" })
    .returning();
  return { course: course!, version: version!, drawn: drawn!, pasted: pasted! };
}

const copiedThumbnails = async (versionId: string) => {
  const sections = await testDb.query.sections.findMany({
    where: (s, { eq }) => eq(s.repoVersionId, versionId),
    with: { lessons: { with: { videos: { with: { thumbnails: true } } } } },
  });
  return sections[0]!.lessons[0]!.videos[0]!.thumbnails;
};

const copies = {
  Submit: (fixture: { course: { id: string }; version: { id: string } }) =>
    run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: fixture.version.id,
          repoId: fixture.course.id,
          sourceName: "v1",
          sourceDescription: "",
        });
      })
    ),
  "Duplicate Course": (fixture: { course: { id: string } }) =>
    run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: fixture.course.id,
          name: "Dup",
        });
      })
    ),
};

describe.each(Object.entries(copies))("%s", (_name, copy) => {
  it("records the original Thumbnail Diagram as the copy's source, after the original's own", async () => {
    const fixture = await createVideoWithThumbnails();

    const result = await copy(fixture);
    const thumbnails = await copiedThumbnails(result.version.id);
    const copied = thumbnails.find((t) => t.thumbnailDiagram !== null)!;

    expect(copied.thumbnailDiagram).toEqual(drawing);
    expect(copied.diagramSources).toEqual([
      inserted,
      { kind: "thumbnail-diagram", thumbnailId: fixture.drawn.id },
    ]);
  });

  it("records nothing for a pasted-PNG Thumbnail, which has no Thumbnail Diagram", async () => {
    const fixture = await createVideoWithThumbnails();

    const result = await copy(fixture);
    const thumbnails = await copiedThumbnails(result.version.id);
    const copied = thumbnails.find((t) => t.filePath?.endsWith("pasted.png"))!;

    expect(copied.thumbnailDiagram).toBeNull();
    expect(copied.diagramSources).toEqual([]);
  });
});
