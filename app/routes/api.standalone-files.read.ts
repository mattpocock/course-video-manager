import { Console, Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.standalone-files.read";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { data } from "react-router";

const readFileSchema = Schema.Struct({
  videoId: Schema.String,
  filename: Schema.String,
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
  const filename = url.searchParams.get("filename");

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(readFileSchema)({
      videoId,
      filename,
    });

    const videoOps = yield* VideoOperationsService;
    const fs = yield* FileSystem.FileSystem;

    // Validate video exists and is a standalone video
    const video = yield* videoOps.getVideoDeepById(parsed.videoId);
    if (video.lessonId !== null) {
      return yield* Effect.die(
        data("Cannot read files from lesson-connected videos", { status: 400 })
      );
    }

    // Construct file path
    const filePath = getStandaloneVideoFilePath(
      parsed.videoId,
      parsed.filename
    );

    // Check if file exists
    const fileExists = yield* fs.exists(filePath);
    if (!fileExists) {
      return yield* Effect.die(data("File not found", { status: 404 }));
    }

    // Read file as binary data
    const content = yield* fs.readFile(filePath);

    // Determine MIME type
    const mimeType = getMimeType(parsed.filename);

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
