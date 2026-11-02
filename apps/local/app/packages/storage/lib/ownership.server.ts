import { Data, Effect } from "effect";
import {
  avCalibrations,
  clips,
  overlays,
  recordingSessions,
  videos as videosTable,
} from "@cvm/core/db/schema";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { eq, isNotNull } from "drizzle-orm";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import {
  assignStorageBuckets,
  type StorageOwnership,
  type StorageOwnershipInput,
} from "./buckets";
import { UNUSED_FOOTAGE_MIN_AGE_MS } from "./unused-wire";

/** Loading what owns which file failed; the scan cannot start. */
export class StorageOwnershipLoadError extends Data.TaggedError(
  "StorageOwnershipLoadError"
)<{ readonly message: string }> {}

/**
 * What the database says owns each file: every Course, every Video (in any
 * Version, archived or not) with the names of its current Exported Video,
 * and every Footage path any Clip (archived ones too: they can come back), any
 * B-roll (on any Clip, for the same reason) or Recording Session uses.
 * Read-only.
 *
 * A Recording Session no Clip points at uses its files only while it is
 * still recording, or for 7 days after it started (#2157): after that, with
 * no Clip, live or archived, drawn from it, its files are Unused Footage. An
 * AV Calibration's files and a Video's original footage path are never
 * Unused Footage to delete (`keptFootage`).
 */
export const loadStorageOwnership = (
  db: Database,
  roots: readonly string[],
  now: Date = new Date()
): Effect.Effect<StorageOwnership, StorageOwnershipLoadError> =>
  Effect.tryPromise({
    try: async () => {
      const [
        courses,
        videos,
        clipRows,
        sessionRows,
        calibrationRows,
        originalRows,
        bRollRows,
      ] = await Promise.all([
        db.query.courses.findMany({ columns: { id: true, name: true } }),
        listVideosForExportHash(db),
        db
          .select({
            videoId: clips.videoId,
            stored: clips.videoFilename,
            recordingSessionId: clips.recordingSessionId,
          })
          .from(clips),
        db
          .select({
            id: recordingSessions.id,
            videoId: recordingSessions.videoId,
            camera: recordingSessions.cameraFilePath,
            screen: recordingSessions.screenFilePath,
            mic: recordingSessions.micFilePath,
            status: recordingSessions.status,
            startedAt: recordingSessions.startedAt,
          })
          .from(recordingSessions),
        db
          .select({
            mic: avCalibrations.micFilePath,
            script: avCalibrations.scriptFilePath,
            camera: avCalibrations.cameraFilePath,
          })
          .from(avCalibrations),
        db
          .select({ original: videosTable.originalFootagePath })
          .from(videosTable),
        db
          .select({ videoId: clips.videoId, stored: overlays.footagePath })
          .from(overlays)
          .innerJoin(clips, eq(overlays.clipId, clips.id))
          .where(isNotNull(overlays.footagePath)),
      ]);

      const footageUses: StorageOwnershipInput["footageUses"][number][] = [];
      const sessionFiles = new Map(
        sessionRows.map((s) => [s.id, [s.camera, s.screen, s.mic]] as const)
      );
      const sessionsWithClips = new Set<string>();
      for (const clip of clipRows) {
        footageUses.push({ stored: clip.stored, videoId: clip.videoId });
        if (clip.recordingSessionId === null) continue;
        sessionsWithClips.add(clip.recordingSessionId);
        for (const stored of sessionFiles.get(clip.recordingSessionId) ?? []) {
          footageUses.push({
            stored,
            videoId: clip.videoId,
            recordingSession: true,
          });
        }
      }
      for (const bRoll of bRollRows) {
        if (bRoll.stored === null) continue;
        footageUses.push({ stored: bRoll.stored, videoId: bRoll.videoId });
      }
      // A Recording Session no Clip points at still uses its files while it
      // is recording, and for 7 days after it started; then they are Unused.
      const youngerThan = now.getTime() - UNUSED_FOOTAGE_MIN_AGE_MS;
      for (const session of sessionRows) {
        if (sessionsWithClips.has(session.id)) continue;
        const stillInUse =
          session.status === "recording" ||
          session.startedAt.getTime() > youngerThan;
        if (!stillInUse) continue;
        for (const stored of [session.camera, session.screen, session.mic]) {
          footageUses.push({
            stored,
            videoId: session.videoId,
            recordingSession: true,
          });
        }
      }

      const input: StorageOwnershipInput = {
        courses,
        videos: videos.map((video) => {
          const hash = computeExportHash(
            toExportClips(video.clips),
            video.format,
            roots
          );
          const names = [`${video.id}.mp4`];
          if (hash) names.push(`${video.courseId ?? video.id}-${hash}.mp4`);
          return {
            id: video.id,
            courseId: video.courseId,
            format: video.format,
            exportNames: names,
          };
        }),
        footageUses,
        keptFootage: [
          ...calibrationRows.flatMap((c) =>
            [c.mic, c.script, c.camera].filter(
              (p): p is string => p !== null && p !== ""
            )
          ),
          ...originalRows.map((v) => v.original).filter((p) => p !== ""),
        ],
      };
      return assignStorageBuckets(input, roots);
    },
    catch: (cause) =>
      new StorageOwnershipLoadError({
        message: `Could not read what owns each file: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
