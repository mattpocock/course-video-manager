import { Effect, Schema } from "effect";
import { JOB_PARAMS } from "../job-params";
import { CoursePublishService } from "@/services/course-publish-service";
import type { ExportStage } from "@/services/course-publish-export-events";
import { defineJobKind, type JobContext } from "../job-kind";
import { makeOrderedEvents } from "../ordered-events";
import { UPLOAD_MANAGER_POLICIES } from "../retry-policy";
import { EXPORT_EVENTS, ExportedEvent } from "@/features/jobs/export-job";

/** The stages an export reports; `queued` is the browser's, before it starts. */
type ExportWorkStage = Exclude<ExportStage, "queued">;

/**
 * Report an export's stages and ffmpeg percentages as `stage` / `progress`
 * Job Events, in order.
 */
const reportInOrder = (ctx: JobContext) =>
  Effect.gen(function* () {
    const events = yield* makeOrderedEvents(ctx);
    // ffmpeg repeats a percentage many times over; only a change is news.
    let last: { stage: ExportWorkStage; percent: number } | null = null;
    return {
      onStage: (stage: ExportWorkStage) => {
        last = null;
        events.emit("stage", { stage });
      },
      onProgress: (info: { stage: ExportWorkStage; percent: number }) => {
        if (last?.stage === info.stage && last.percent === info.percent) {
          return;
        }
        last = info;
        events.emit("progress", { stage: info.stage, percent: info.percent });
      },
      exported: (path: string) => {
        events.emit(
          EXPORT_EVENTS.exported,
          Schema.encodeSync(ExportedEvent)({ path })
        );
      },
      flush: events.flush,
    };
  });

/**
 * **Video export** (#6 in docs/plans/background-jobs-sidecar.md): the same
 * `CoursePublishService.exportVideo` the `export-sse` route used to run, now
 * driven by the sidecar, so closing the tab no longer stops it. Its stages and
 * ffmpeg percentages become `stage` / `progress` Job Events, which the Upload
 * Manager draws exactly as it drew the stream's. 3 attempts, in the default
 * lane — copied from the Upload Manager (`retry-policy.ts`). Its last Job
 * Event, `exported`, names the Exported Video, which `cvm video export` prints.
 */
export const exportJobKind = defineJobKind({
  ...UPLOAD_MANAGER_POLICIES.export,
  params: JOB_PARAMS["export"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const publish = yield* CoursePublishService;
      const reports = yield* reportInOrder(ctx);
      yield* Effect.logInfo("export: started", { videoId: params.videoId });
      const exportPath = yield* publish
        .exportVideo(params.videoId, reports.onStage, reports.onProgress)
        .pipe(
          Effect.tap((path) => Effect.sync(() => reports.exported(path))),
          Effect.ensuring(reports.flush)
        );
      yield* Effect.logInfo("export: done", { exportPath });
    }),
});
