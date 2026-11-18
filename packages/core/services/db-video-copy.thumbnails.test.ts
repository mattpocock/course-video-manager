import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { copyVideoImpl } from "./db-video-operations.copy.server.js";
import type { Database } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";
import * as schema from "../db/schema.js";

/**
 * Copying a Video copies each Thumbnail's Thumbnail Diagram, recording the
 * original as the source (ADR 0060), as Submit and Duplicate Course do. The
 * copy has a fresh lineage, so its Thumbnails' paths are rebased onto it (the
 * route copies the Video Files themselves): verbatim, they would alias the
 * source's PNGs (#1674).
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const drawing = {
  store: { "shape:box": { id: "shape:box", typeName: "shape", type: "text" } },
  schema: { schemaVersion: 2, sequences: {} },
};

const inserted = {
  kind: "diagram-component",
  diagramComponentId: "component-1",
} as const;

async function createVideoWithThumbnails() {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "video-01.mp4", originalFootagePath: "/footage/raw.mp4" })
    .returning();
  const dir = `video-files/${video!.lineageId}`;
  const [drawn] = await testDb
    .insert(schema.thumbnails)
    .values({
      videoId: video!.id,
      layers: {
        backgroundPhoto: { filePath: `${dir}/t-bg.png`, horizontalPosition: 0 },
        diagram: null,
        cutout: { filePath: `${dir}/t-cutout.png`, horizontalPosition: 40 },
      },
      filePath: `${dir}/t.png`,
      thumbnailDiagram: drawing,
      diagramSearchText: "Box",
      diagramSources: [inserted],
    })
    .returning();
  const [pasted] = await testDb
    .insert(schema.thumbnails)
    .values({
      videoId: video!.id,
      layers: { backgroundPhoto: null, diagram: null, cutout: null },
      filePath: `${dir}/pasted.png`,
    })
    .returning();
  await testDb.insert(schema.thumbnails).values({
    videoId: video!.id,
    layers: {},
    filePath: `${dir}/archived.png`,
    archivedAt: new Date(),
  });
  return { video: video!, drawn: drawn!, pasted: pasted! };
}

const copy = (sourceVideoId: string) =>
  Effect.runPromise(
    copyVideoImpl(testDb as unknown as Database, {
      sourceVideoId,
      newTitle: "Copy",
      copyClips: false,
      copyBeats: false,
      copyScript: false,
      renameOld: false,
    })
  );

const thumbnailsOf = async (videoId: string) => {
  const video = await testDb.query.videos.findFirst({
    where: (v, { eq }) => eq(v.id, videoId),
    with: { thumbnails: true },
  });
  return video!;
};

describe("copyVideo — Thumbnails", () => {
  it("copies each live Thumbnail's Thumbnail Diagram, recording the original after its own sources", async () => {
    const { drawn } = await createVideoWithThumbnails();

    const copyId = await copy(drawn.videoId);
    const { thumbnails } = await thumbnailsOf(copyId);
    const copied = thumbnails.find((t) => t.thumbnailDiagram !== null)!;

    expect(copied.thumbnailDiagram).toEqual(drawing);
    expect(copied.diagramSearchText).toBe("Box");
    expect(copied.diagramSources).toEqual([
      inserted,
      { kind: "thumbnail-diagram", thumbnailId: drawn.id },
    ]);
  });

  it("records nothing for a pasted-PNG Thumbnail, and leaves an archived one behind", async () => {
    const { video } = await createVideoWithThumbnails();

    const copyId = await copy(video.id);
    const { thumbnails } = await thumbnailsOf(copyId);

    expect(thumbnails).toHaveLength(2);
    const pasted = thumbnails.find((t) => t.thumbnailDiagram === null)!;
    expect(pasted.diagramSources).toEqual([]);
  });

  it("points the copied Thumbnails at the copy's own Video Files", async () => {
    const { video } = await createVideoWithThumbnails();

    const copyId = await copy(video.id);
    const copyVideo = await thumbnailsOf(copyId);
    const copied = copyVideo.thumbnails.find((t) => t.thumbnailDiagram)!;
    const dir = `video-files/${copyVideo.lineageId}`;

    expect(copied.filePath).toBe(`${dir}/t.png`);
    expect(copied.layers).toEqual({
      backgroundPhoto: { filePath: `${dir}/t-bg.png`, horizontalPosition: 0 },
      diagram: null,
      cutout: { filePath: `${dir}/t-cutout.png`, horizontalPosition: 40 },
    });
  });
});
