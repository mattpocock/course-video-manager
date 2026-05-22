/**
 * ClipService Route
 *
 * Single POST endpoint that handles all clip operations via RPC-style events.
 * Replaces multiple individual route files (clips.archive.ts, clips.reorder.ts, etc.)
 */

import {
  handleClipServiceEvent,
  type VideoProcessingAdapter,
  type LoggerAdapter,
} from "@/services/clip-service-handler";
import { ClipServiceEventSchema } from "@/services/clip-service.schemas";
import type { ClipServiceEvent } from "@/services/clip-service";
import { DrizzleService } from "@/services/drizzle-service.server";
import { withDatabaseDump } from "@/services/dump-service";
import { runtimeLive } from "@/services/layer.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import { Console, Effect, Schema } from "effect";
import { data } from "react-router";
import type { Route } from "./+types/api.clip-service";

export const action = async (args: Route.ActionArgs) => {
  const json = await args.request.json();

  return Effect.gen(function* () {
    // Parse and validate the event
    const event = yield* Schema.decodeUnknown(ClipServiceEventSchema)(json);

    // Get VideoProcessingService for OBS operations
    const videoProcessingService = yield* VideoProcessingService;

    // Create adapter that wraps Effect-based service
    const videoProcessingAdapter: VideoProcessingAdapter = {
      getLatestOBSVideoClips: (opts) =>
        videoProcessingService
          .getLatestOBSVideoClips(opts)
          .pipe(runtimeLive.runPromise),
    };

    // Create logger adapter
    const loggerService = yield* VideoEditorLoggerService;
    const logger: LoggerAdapter = {
      log: (videoId, event) => {
        loggerService.log(videoId, event).pipe(runtimeLive.runPromise);
      },
    };

    // Use the managed DrizzleService instead of creating a new connection per request
    const db = yield* DrizzleService;
    const result = yield* handleClipServiceEvent(
      db as any,
      event as ClipServiceEvent,
      videoProcessingAdapter,
      logger
    );

    return result ?? null;
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll((error: unknown) => {
      // Check if it's a "not found" type error
      if (
        error instanceof Error &&
        (error.message.includes("not found") ||
          error.message.includes("Could not find"))
      ) {
        return Effect.die(data(error.message, { status: 404 }));
      }
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
