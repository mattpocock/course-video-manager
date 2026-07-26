/**
 * PROTOTYPE — throwaway.
 *
 * Everything the teleprompter can put on the glass, for one video, in one call:
 * the Script and the Beat plan. Polled every few seconds so edits made in the
 * main window appear without a reload.
 *
 * Deliberately separate from `api.videos.$videoId.script.ts`: that route also
 * resolves the full writer context, which is far too much to fetch on a loop.
 */
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const beatOps = yield* BeatOperationsService;

      const [video, beats] = yield* Effect.all(
        [
          videoOps.getVideoWithLessonById(videoId),
          beatOps.listBeatsByVideoId(videoId),
        ],
        { concurrency: "unbounded" }
      );

      return {
        title: video.title,
        script: video.script ?? "",
        beats: beats.map((beat) => ({
          id: beat.id,
          kind: beat.kind,
          title: beat.title,
          description: beat.description,
        })),
      };
    }),
});
