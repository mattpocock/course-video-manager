import { Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.courses.$courseId.publish-sse";
import { CoursePublishService } from "@/services/course-publish-service";
import type { PublishDetailEvent } from "@/services/course-publish-export-events";
import { createSSEResponse } from "@/lib/create-sse-response.server";

// The per-video export events (batchExport's `videos`/`stage`/`complete`/
// `error` payloads, unchanged) and the Dropbox commit's `progress` percentage
// ride on their own wire names so the publish-level `progress` ({stage}),
// `complete`, and `error` events stay exactly as before. `satisfies` keeps the
// map exhaustive: a new detail event without a wire name is a compile error.
const DETAIL_EVENT_WIRE_NAMES = {
  videos: "export-videos",
  stage: "export-stage",
  "video-progress": "export-progress",
  complete: "export-complete",
  error: "export-error",
  progress: "upload-progress",
} satisfies Record<PublishDetailEvent["event"], string>;

const publishSchema = Schema.Struct({
  name: Schema.String,
  // Required, like name: a Published Version always carries a description (it
  // feeds the changelog and the frozen snapshot). The publish page gates on a
  // non-empty value; this just refuses a payload that omits the field.
  description: Schema.String,
  includeTodoLessons: Schema.optional(Schema.Boolean),
});

export const action = async (args: Route.ActionArgs) => {
  const { courseId } = args.params;
  const body = await args.request.json();
  const parsed = Schema.decodeUnknownSync(publishSchema)(body);

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const publishService = yield* CoursePublishService;

        const result = yield* publishService.publish({
          courseId,
          versionName: parsed.name,
          versionDescription: parsed.description,
          includeTodoLessons: parsed.includeTodoLessons ?? true,
          onStageChange: (stage) => {
            sendEvent("progress", { stage });
          },
          onDetailEvent: (e) => {
            sendEvent(DETAIL_EVENT_WIRE_NAMES[e.event], e.data);
          },
        });

        sendEvent("complete", {
          publishedVersionId: result.publishedVersionId,
          newDraftVersionId: result.newDraftVersionId,
        });
      }),
    errorHandlers: [
      {
        tag: "PublishValidationError",
        handler: (e, sendEvent) => {
          const parts: string[] = [];
          if (e.courseViewLintCount && e.courseViewLintCount > 0) {
            parts.push(
              `${e.courseViewLintCount} course warning(s) must be fixed`
            );
          }
          if (e.failedExportVideoIds && e.failedExportVideoIds.length > 0) {
            parts.push(
              `${e.failedExportVideoIds.length} video(s) failed to export`
            );
          }
          sendEvent("error", {
            message: parts.join("; ") || "Publish validation failed",
            type: "validation",
            courseViewLintCount: e.courseViewLintCount ?? 0,
            failedExportVideoIds: e.failedExportVideoIds ?? [],
          });
        },
      },
      {
        // A caught Commit failure auto-Discards the Pending Version (issue
        // #1401) — this is a plain, terminal error, not a recoverable state.
        // The Submitted content lives on unchanged in the new Draft.
        tag: "PublishCommitFailedError",
        handler: (e, sendEvent) => {
          // #1401: name the missing Videos — the client surfaces only
          // `message`, so the ids must ride in the text itself.
          const missing = e.missingVideoIds ?? [];
          const message =
            e.reason === "missing_assets"
              ? `Publish discarded: ${missing.length} video file(s) were missing from the export directory (${missing.join(", ")}). Nothing was lost — your edits are safe in the Draft. Re-export and publish again`
              : "Publish discarded: the Dropbox commit failed (after one retry). Nothing was lost — your edits are safe in the Draft. Publish again when Dropbox is reachable";
          sendEvent("error", {
            message,
            missingVideoIds: missing,
          });
        },
      },
      {
        tag: "NotFoundError",
        handler: (_, sendEvent) => {
          sendEvent("error", { message: "Course not found" });
        },
      },
    ],
    fallbackMessage: "Publish failed unexpectedly",
  });
};
