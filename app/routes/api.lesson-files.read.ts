import { Console, Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.lesson-files.read";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import path from "path";

const readFileSchema = Schema.Struct({
  videoId: Schema.String,
  filePath: Schema.String,
});

// Simple MIME type detection based on file extension
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const mimeTypes: Record<string, string> = {
    // Images
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // Text
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    xml: "application/xml",
    csv: "text/csv",
    // Code
    js: "text/javascript",
    ts: "text/typescript",
    jsx: "text/javascript",
    tsx: "text/typescript",
    html: "text/html",
    css: "text/css",
    // Archives
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
    // Default
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const videoId = url.searchParams.get("videoId");
  const filePathParam = url.searchParams.get("filePath");

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(readFileSchema)({
      videoId,
      filePath: filePathParam,
    });

    const videoOps = yield* VideoOperationsService;
    const fs = yield* FileSystem.FileSystem;

    // Validate video exists and is a lesson-connected video
    const video = yield* videoOps.getVideoWithClipsById(parsed.videoId);
    if (video.lessonId === null) {
      return yield* Effect.die(
        data("Cannot read files from standalone videos via this endpoint", {
          status: 400,
        })
      );
    }

    const lesson = video.lesson!;
    const repo = lesson.section.repoVersion.repo;
    const section = lesson.section;
    const lessonPath = path.join(repo.filePath!, section.path, lesson.path);

    // Construct full file path
    const fullFilePath = path.join(lessonPath, parsed.filePath);

    // Check if file exists
    const fileExists = yield* fs.exists(fullFilePath);
    if (!fileExists) {
      return yield* Effect.die(data("File not found", { status: 404 }));
    }

    // Read file as binary data
    const content = yield* fs.readFile(fullFilePath);

    // Determine MIME type
    const mimeType = getMimeType(parsed.filePath);

    // Convert Uint8Array to Buffer for Response
    return new Response(Buffer.from(content), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
      },
    });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
