import {
  handleClipServiceEvent,
  type LoggerAdapter,
} from "@/services/clip-service-handler";
import { ClipServiceEventSchema } from "@/services/clip-service.schemas";
import type { ClipServiceEvent } from "@/services/clip-service";
import { DrizzleService } from "@/services/drizzle-service.server";
import { runtimeLive } from "@/services/layer.server";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import { Effect, Schema } from "effect";
import { data } from "react-router";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  input: "json",
  errors: {
    // Write-closure: writes into a Pending/Published version are refused.
    VersionNotDraftError: 409,
    // A mic offset change on a Recording Session a non-Draft Version shares.
    MicOffsetSharedWithFrozenVersionError: 409,
  },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknown(ClipServiceEventSchema)(
        payload
      );

      const loggerService = yield* VideoEditorLoggerService;
      const logger: LoggerAdapter = {
        log: (videoId, event) => {
          // Fire-and-forget: LoggerAdapter.log returns void so a log line
          // never holds up the clip-service event it describes.
          void loggerService.log(videoId, event).pipe(runtimeLive.runPromise);
        },
      };

      const db = yield* DrizzleService;
      const result = yield* handleClipServiceEvent(
        db,
        event as ClipServiceEvent,
        logger
      );

      return result ?? null;
    }).pipe(
      Effect.catchAll((error: unknown) => {
        if (
          error instanceof Error &&
          (error.message.includes("not found") ||
            error.message.includes("Could not find"))
        ) {
          return Effect.die(data(error.message, { status: 404 }));
        }
        return Effect.fail(error);
      })
    ),
});
