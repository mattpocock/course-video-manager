import { loadWriterContext } from "@/services/video-posting-context.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader, makeAction } from "@/services/route-action.server";
import { Effect } from "effect";

/**
 * On-demand data for opening the lesson writer / SEO modals from anywhere
 * (course view, video editor) without being on the Lesson tab. Returns the
 * current body/description plus the resolved writer context.
 */
export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoWithLessonById(videoId);
      const writerContext = yield* loadWriterContext(videoId);
      return {
        body: video.body,
        description: video.description,
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

      if (data.intent === "updateBody") {
        yield* videoOps.updateVideoBody({
          videoId,
          body: data.body || null,
        });
        return { ok: true };
      }

      if (data.intent === "updateDescription") {
        yield* videoOps.updateVideoDescription({
          videoId,
          description: data.description || null,
        });
        return { ok: true };
      }

      return { ok: false };
    }),
});
