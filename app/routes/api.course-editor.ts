/**
 * CourseEditorService Route
 *
 * Single POST endpoint that handles all course editor mutations via
 * RPC-style events. Replaces individual section/lesson mutation routes.
 */

import { handleCourseEditorEvent } from "@/services/course-editor-service-handler";
import { CourseEditorEventSchema } from "@/services/course-editor-service.schemas";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { withDatabaseDump } from "@/services/dump-service";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect, Schema } from "effect";
import { data } from "react-router";
import type { Route } from "./+types/api.course-editor";

export const action = async (args: Route.ActionArgs) => {
  const json = await args.request.json();

  return Effect.gen(function* () {
    const event = yield* Schema.decodeUnknown(CourseEditorEventSchema)(json);

    const result = yield* handleCourseEditorEvent(event as CourseEditorEvent);

    return result ?? null;
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("CourseRepoSyncError", (e) => {
      return Effect.die(data(e.message, { status: 409 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Not found", { status: 404 }));
    }),
    Effect.catchTag("CourseWriteError", (e) => {
      return Effect.die(data(e.message, { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
