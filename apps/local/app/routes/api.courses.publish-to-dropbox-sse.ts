import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import type { Route } from "./+types/api.courses.publish-to-dropbox-sse";
import { ConfigProvider, Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import {
  ANNOUNCE_NOTHING_BAND,
  PLACEHOLDER_FLOOR_BANDS,
  placeholderFloorFromBand,
} from "@/packages/course-json";

const publishRepoSchema = Schema.Struct({
  repoId: Schema.String,
  courseVersionId: Schema.optional(Schema.String),
  includeTodoLessons: Schema.optional(Schema.Boolean),
  // THE FLOOR THE INTERRUPTED PUBLISH WAS SHIPPING AT, as its band. The floor
  // is never recorded on a Version (ADR 0029), so a retry or resume can only
  // know it from the client that still holds it — and it must, because the floor
  // is inside the Bundle address: a retry that forgot it would address a
  // different Bundle and commit a manifest missing its Placeholder Lessons.
  // Absent still means announce nothing, so a client that predates the control
  // re-syncs exactly as it did before.
  placeholders: Schema.optional(Schema.Literal(...PLACEHOLDER_FLOOR_BANDS)),
});

export const action = async ({ request }: Route.ActionArgs) => {
  const body = await request.json();

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknown(publishRepoSchema)(body);

        const publishService = yield* CoursePublishService;
        // Pending commits must retry the exact frozen Course Version with the
        // original to-do policy AND the original Placeholder Floor — the three
        // together are what decide the Bundle address, so anything less is a
        // different release. Without an id, re-sync the latest frozen version.
        const placeholderFloor = placeholderFloorFromBand(
          result.placeholders ?? ANNOUNCE_NOTHING_BAND
        );
        const { missingVideos } = result.courseVersionId
          ? yield* publishService.syncFrozenVersionToDropbox(
              result.repoId,
              result.courseVersionId,
              result.includeTodoLessons ?? true,
              sendEvent,
              placeholderFloor
            )
          : yield* publishService.syncToDropbox(
              result.repoId,
              result.includeTodoLessons ?? true,
              sendEvent,
              placeholderFloor
            );

        sendEvent("complete", {
          missingVideoCount: missingVideos.length,
        });
      }).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv())),
    errorHandlers: [
      {
        tag: "DropboxNotAuthenticatedError",
        handler: (_error, sendEvent) => {
          sendEvent("error", {
            message:
              "Dropbox is not connected. Connect your Dropbox account before publishing.",
          });
        },
      },
    ],
    fallbackMessage: "Publish failed unexpectedly",
  });
};
