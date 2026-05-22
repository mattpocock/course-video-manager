import { CoursePublishService } from "@/services/course-publish-service";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import { createReadStream, statSync } from "fs";
import type { Route } from "./+types/api.videos.$videoId.stream";
import { data } from "react-router";

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  const request = args.request;

  const videoPath = await Effect.gen(function* () {
    const publishService = yield* CoursePublishService;
    return yield* publishService.resolveExportPath(videoId);
  }).pipe(
    Effect.catchAll(() => Effect.succeed(null)),
    runtimeLive.runPromise
  );

  if (!videoPath) {
    return new Response(null, { status: 404 });
  }

  try {
    const stat = statSync(videoPath);
    const fileSize = stat.size;

    const range = request.headers.get("range");

    let start: number;
    let end: number;

    if (range) {
      // Handle range requests for video seeking
      const parts = range.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0]!, 10);
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    } else {
      start = 0;
      end = 1000;
    }

    const chunksize = end - start + 1;

    const stream = createReadStream(videoPath, { start, end });

    return new Response(stream as any, {
      status: 206, // Partial Content
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize.toString(),
        "Content-Type": "video/mp4",
      },
    });
  } catch (error) {
    return new Response(null, {
      status: 404,
    });
  }
};

export const action = async (args: Route.ActionArgs) => {
  if (args.request.method !== "DELETE") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const { videoId } = args.params;

  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const fs = yield* FileSystem.FileSystem;
    const publishService = yield* CoursePublishService;

    // Verify video exists in DB
    yield* videoOps.getVideoDeepById(videoId);

    const videoPath = yield* publishService.resolveExportPath(videoId);

    if (!videoPath) {
      return { success: true, deletedPath: null };
    }

    const exists = yield* fs.exists(videoPath);
    if (!exists) {
      return { success: true, deletedPath: videoPath };
    }

    // Delete file (handle ENOENT as success)
    yield* fs.remove(videoPath);

    return { success: true, deletedPath: videoPath };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
