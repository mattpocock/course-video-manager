import { Command } from "@effect/cli";
import { Effect } from "effect";
import { draftIdArg } from "../entity-id";
import { detail, emitObject, notFound } from "../helpers";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  buildVideoChaptersFromRows,
  toYouTubeChapters,
} from "@/services/video-chapters";
import {
  expectedExportDurationInSeconds,
  paddedClipDurationsInSeconds,
} from "@/services/export-duration-check";
import { CHAPTERS_HELP } from "./video.chapters.help";

/**
 * `cvm video chapters <id>` — a Video's chapter list with the start time of
 * each Chapter in the exported video: the very list the published course.json
 * and the "Copy YouTube chapters" button carry (services/video-chapters.ts),
 * for a caller outside the CVM (an AI Hero post's chapters, say).
 */
export const chaptersCommand = Command.make(
  "chapters",
  { id: draftIdArg("video") },
  ({ id: ref }) =>
    Effect.gen(function* () {
      const id = yield* ref;
      const video = yield* Effect.flatMap(VideoOperationsService, (svc) =>
        svc.getVideoWithClipsById(id)
      ).pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));

      const chapters = buildVideoChaptersFromRows(video.clips, video.chapters);
      const youtube = toYouTubeChapters(chapters);
      yield* emitObject({
        id: video.id,
        title: video.title,
        exportDurationSeconds: expectedExportDurationInSeconds(
          paddedClipDurationsInSeconds(video.clips)
        ),
        chapters: chapters.map((chapter, i) => ({
          title: chapter.title,
          startTime: chapter.startTime,
          timestamp: youtube[i]!.timestamp,
        })),
      });
    })
).pipe(Command.withDescription(detail(CHAPTERS_HELP)));
