import { loadWriterContext } from "@/services/video-posting-context.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader, makeAction } from "@/services/route-action.server";
import { Effect } from "effect";

/**
 * On-demand data for editing a video's Script from anywhere (course-view context
 * menu, video-editor Script tab) — the current script plus the resolved writer
 * context the WritableField needs. Mirrors the lesson-writer route.
 */
export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoWithLessonById(videoId);
      const writerContext = yield* loadWriterContext(videoId);
      return {
        script: video.script,
        writerContext,
      };
    }),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const data = payload as Record<string, string>;

      if (data.intent === "updateScript") {
        yield* videoOps.updateVideoScript({
          videoId,
          script: data.script || null,
        });
        return { ok: true };
      }

      return { ok: false };
    }),
});
