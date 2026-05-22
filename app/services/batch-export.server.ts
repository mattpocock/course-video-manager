import { Config, Effect, Schedule } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  VideoProcessingService,
  type BeatType,
} from "@/services/video-processing-service";
import { FINAL_VIDEO_PADDING } from "@/features/video-editor/constants";
import path from "node:path";

const MAX_CONCURRENT_EXPORTS = 6;

export const batchExportProgram = (
  versionId: string,
  sendEvent: (event: string, data: unknown) => void
) =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    const videoProcessing = yield* VideoProcessingService;
    const fs = yield* FileSystem.FileSystem;
    const FINISHED_VIDEOS_DIRECTORY = yield* Config.string(
      "FINISHED_VIDEOS_DIRECTORY"
    );

    // Find unexported videos
    const version = yield* versionOps.getVersionWithSections(versionId);

    const unexportedVideos: Array<{
      id: string;
      title: string;
      clips: Array<{
        videoFilename: string;
        sourceStartTime: number;
        sourceEndTime: number;
        beatType: string;
      }>;
    }> = [];

    for (const section of version.sections) {
      for (const lesson of section.lessons) {
        // Skip ghost lessons — they have no videos on disk
        if (lesson.fsStatus === "ghost") continue;
        for (const video of lesson.videos) {
          if (video.clips.length > 0) {
            const exportedVideoPath = path.join(
              FINISHED_VIDEOS_DIRECTORY,
              `${video.id}.mp4`
            );
            const exists = yield* fs.exists(exportedVideoPath);

            if (!exists) {
              unexportedVideos.push({
                id: video.id,
                title: `${section.path}/${lesson.path}/${video.path}`,
                clips: video.clips,
              });
            }
          }
        }
      }
    }

    // Send initial videos event
    sendEvent("videos", {
      videos: unexportedVideos.map((v) => ({ id: v.id, title: v.title })),
    });

    if (unexportedVideos.length === 0) {
      return;
    }

    // Send queued stage for all videos
    for (const video of unexportedVideos) {
      sendEvent("stage", { videoId: video.id, stage: "queued" });
    }

    yield* Effect.forEach(
      unexportedVideos,
      (video) =>
        videoProcessing
          .exportVideoClips({
            videoId: video.id,
            shortsDirectoryOutputName: undefined,
            clips: video.clips.map((clip, index, array) => {
              const isFinalClip = index === array.length - 1;
              return {
                inputVideo: clip.videoFilename,
                startTime: clip.sourceStartTime,
                duration:
                  clip.sourceEndTime -
                  clip.sourceStartTime +
                  (isFinalClip ? FINAL_VIDEO_PADDING : 0),
                beatType: clip.beatType as BeatType,
              };
            }),
            onStageChange: (stage) => {
              sendEvent("stage", { videoId: video.id, stage });
            },
          })
          .pipe(
            Effect.retry(Schedule.recurs(2)),
            Effect.tap(() => {
              sendEvent("complete", { videoId: video.id });
            }),
            Effect.catchAll((e) =>
              Effect.sync(() => {
                sendEvent("error", {
                  videoId: video.id,
                  message:
                    "message" in e && typeof e.message === "string"
                      ? e.message
                      : "Export failed unexpectedly",
                });
              })
            )
          ),
      { concurrency: MAX_CONCURRENT_EXPORTS }
    );
  }).pipe(
    Effect.catchTag("NotFoundError", () =>
      Effect.sync(() => {
        sendEvent("error", {
          videoId: null,
          message: "Version not found",
        });
      })
    ),
    Effect.catchAll((e) =>
      Effect.sync(() => {
        sendEvent("error", {
          videoId: null,
          message:
            "message" in e && typeof e.message === "string"
              ? e.message
              : "Batch export failed unexpectedly",
        });
      })
    )
  );
