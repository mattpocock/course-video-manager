import { Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { AutofillService } from "@/services/autofill-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import type { Route } from "./+types/api.courses.$courseId.autofill-sse";

/**
 * The **Autofill** run, streamed so the app-wide upload surface can show one
 * row per candidate **Video**.
 *
 * A job of its own, not a stage of a **Publish** (ADR 0024): it starts
 * nothing else when it settles, and its failures reach nothing else. The
 * publish pipeline is not touched by this route.
 */
const autofillSchema = Schema.Struct({
  versionId: Schema.String,
  includeTodoLessons: Schema.optional(Schema.Boolean),
});

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();
  const parsed = Schema.decodeUnknownSync(autofillSchema)(body);

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const autofill = yield* AutofillService;

        const result = yield* autofill.autofillCourseVersion({
          versionId: parsed.versionId,
          includeTodoLessons: parsed.includeTodoLessons ?? true,
          // The roster, announced before any work starts. Only candidates are
          // named: a Video the Autofill has no work for gets no row.
          onCandidates: (selection) => {
            sendEvent("autofill-videos", {
              videos: selection.candidates.map((candidate) => ({
                id: candidate.videoId,
                title: candidate.title,
              })),
            });
          },
          onVideoSettled: (videoResult) => {
            sendEvent(
              videoResult.status === "filled"
                ? "autofill-video-complete"
                : "autofill-video-error",
              {
                videoId: videoResult.videoId,
                message: videoResult.message ?? "Autofill failed",
              }
            );
          },
        });

        sendEvent("complete", {
          filled: result.results.filter((r) => r.status === "filled").length,
          failed: result.results.filter((r) => r.status === "failed").length,
          skipped: result.skipped.length,
        });
      }),
    errorHandlers: [
      {
        tag: "AutofillVersionNotDraftError",
        handler: (_, sendEvent) => {
          sendEvent("error", {
            message:
              "Only a Draft Version can be autofilled — reload the publish page",
          });
        },
      },
      {
        tag: "NotFoundError",
        handler: (_, sendEvent) => {
          sendEvent("error", { message: "Course version not found" });
        },
      },
    ],
    fallbackMessage: "Autofill failed unexpectedly",
  });
};
