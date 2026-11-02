import { Effect } from "effect";
import { JOB_PARAMS } from "../job-params";
import { RenderVerticalVideoService } from "@/services/render-vertical-video-service";
import { defineJobKind } from "../job-kind";
import { makeOrderedEvents } from "../ordered-events";
import { UPLOAD_MANAGER_POLICIES } from "../retry-policy";
import { RENDER_VERTICAL_EVENTS } from "@/features/jobs/render-vertical-job";

/**
 * **Vertical Shorts render** (#8 in docs/plans/background-jobs-sidecar.md):
 * concat → subtitles from the Clips → Remotion overlay → composite, through the same
 * `RenderVerticalVideoService.renderVerticalVideo` the `render-vertical-sse`
 * route used to run. Driven by the sidecar, so closing the tab no longer stops
 * it, and its failure lands in the Job's log as well as the Video's. Each
 * stage becomes a `stage` Job Event, which the Upload Manager draws as it drew
 * the stream's. 3 attempts, in the default lane — copied from the Upload
 * Manager (`retry-policy.ts`). Its last Job Event, `rendered`, names the file
 * it wrote, which `cvm short render` prints.
 */
export const renderVerticalJobKind = defineJobKind({
  ...UPLOAD_MANAGER_POLICIES["render-vertical"],
  params: JOB_PARAMS["render-vertical"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const render = yield* RenderVerticalVideoService;
      const events = yield* makeOrderedEvents(ctx);
      yield* Effect.logInfo("render-vertical: started", {
        videoId: params.videoId,
      });
      const outputPath = yield* render
        .renderVerticalVideo({
          videoId: params.videoId,
          onStageChange: (stage) => events.emit("stage", { stage }),
        })
        .pipe(
          Effect.tap((path) =>
            Effect.sync(() =>
              events.emit(RENDER_VERTICAL_EVENTS.rendered, { path })
            )
          ),
          Effect.ensuring(events.flush)
        );
      yield* Effect.logInfo("render-vertical: done", { outputPath });
    }),
});
