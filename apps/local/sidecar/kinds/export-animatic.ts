import { Effect } from "effect";
import { JOB_PARAMS } from "../job-params";
import { exportAnimaticToItsAddress } from "@/services/animatic-export-service";
import { storageRootsConfig } from "@/services/storage-roots";
import { defineJobKind } from "../job-kind";
import { makeOrderedEvents } from "../ordered-events";
import { UPLOAD_MANAGER_POLICIES } from "../retry-policy";

/**
 * **Animatic export**: a Video's Animatic rendered to
 * `finished-videos/{courseId}-{hash}.animatic.mp4`, under the export's own
 * rules (`exportAnimaticToItsAddress`). Started from the Animatic page's
 * Export button. Its one ffmpeg pass reports as the export's
 * `concatenating-clips` stage, so the Upload Manager draws it as an export
 * row. 3 attempts, in the default lane, as an export.
 */
export const exportAnimaticJobKind = defineJobKind({
  ...UPLOAD_MANAGER_POLICIES["export-animatic"],
  params: JOB_PARAMS["export-animatic"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const storageRoots = yield* storageRootsConfig;
      const events = yield* makeOrderedEvents(ctx);
      yield* Effect.logInfo("export-animatic: started", {
        videoId: params.videoId,
      });
      events.emit("stage", { stage: "concatenating-clips" });
      // ffmpeg repeats a percentage many times over; only a change is news.
      let lastPercent = -1;
      const result = yield* exportAnimaticToItsAddress({
        videoId: params.videoId,
        storageRoots,
        onProgress: (percent) => {
          if (percent === lastPercent) return;
          lastPercent = percent;
          events.emit("progress", { stage: "concatenating-clips", percent });
        },
      }).pipe(Effect.ensuring(events.flush));
      yield* Effect.logInfo("export-animatic: done", result);
    }),
});
