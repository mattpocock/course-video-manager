import { asc, eq } from "drizzle-orm";
import { clipLayersRelation } from "./clip-layers-relation.js";
import { clips } from "../db/schema.js";
import { clipRecordingSessionRelation } from "./clip-recording-session-relation.js";
import { overlayExportRelation } from "./db-overlay-operations.server.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * Every Video in the database — every Version of every Course, archived or
 * not, plus Standalone Videos and Pitch Videos — loaded with exactly what its
 * Export Hash is computed from: its live Clips in order, each with its
 * Overlays and Recording Session (as `getVideoWithClipsById` loads them), and
 * the Course its export is named after (`courseId`, null for a Video outside a
 * Course, whose export is named after the Video itself).
 *
 * For the one-off Exported Video rename (#2104), which must find every export
 * any Video still owns. Archived Videos are included on purpose: renaming one
 * more export than needed is harmless; missing one would orphan it.
 */
export const listVideosForExportHash = async (db: Database) => {
  const rows = await db.query.videos.findMany({
    columns: { id: true, format: true },
    with: {
      lesson: {
        columns: {},
        with: {
          section: {
            columns: {},
            with: { repoVersion: { columns: { repoId: true } } },
          },
        },
      },
      clips: {
        columns: {
          videoFilename: true,
          sourceStartTime: true,
          sourceEndTime: true,
          recordingSessionId: true,
          sceneOverride: true,
          pauseType: true,
          zoomType: true,
        },
        orderBy: asc(clips.order),
        where: eq(clips.archived, false),
        with: {
          overlays: overlayExportRelation,
          recordingSession: clipRecordingSessionRelation,
          layers: clipLayersRelation,
        },
      },
    },
  });
  return rows.map(({ lesson, ...video }) => ({
    ...video,
    courseId: lesson?.section.repoVersion.repoId ?? null,
  }));
};

export type VideoForExportHash = Awaited<
  ReturnType<typeof listVideosForExportHash>
>[number];
