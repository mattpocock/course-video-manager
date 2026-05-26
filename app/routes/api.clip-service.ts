import {
  handleClipServiceEvent,
  type VideoProcessingAdapter,
  type LoggerAdapter,
} from "@/services/clip-service-handler";
import { ClipServiceEventSchema } from "@/services/clip-service.schemas";
import type { ClipServiceEvent } from "@/services/clip-service";
import { DrizzleService } from "@/services/drizzle-service.server";
import { runtimeLive } from "@/services/layer.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import { Effect, Schema } from "effect";
import { data } from "react-router";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknown(ClipServiceEventSchema)(
        payload
      );

      const videoProcessingService = yield* VideoProcessingService;

      const videoProcessingAdapter: VideoProcessingAdapter = {
        getLatestOBSVideoClips: (opts) =>
          videoProcessingService
            .getLatestOBSVideoClips(opts)
            .pipe(runtimeLive.runPromise),
      };

      const loggerService = yield* VideoEditorLoggerService;
      const logger: LoggerAdapter = {
        log: (videoId, event) => {
          loggerService.log(videoId, event).pipe(runtimeLive.runPromise);
        },
      };

      const db = yield* DrizzleService;
      const result = yield* handleClipServiceEvent(
        db as any,
        event as ClipServiceEvent,
        videoProcessingAdapter,
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
