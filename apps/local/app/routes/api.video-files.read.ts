import { Effect, Schema } from "effect";
import type { Route } from "./+types/api.video-files.read";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { readVideoFile, videoFileExists } from "@/services/video-files";
import { data } from "react-router";

const readFileSchema = Schema.Struct({
  videoId: Schema.String,
  path: Schema.String.pipe(Schema.minLength(1)),
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
  const filePath = url.searchParams.get("path");

  return makeLoader({
    errors: { InvalidVideoFilePathError: 400 },
    effect: () =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknown(readFileSchema)({
          videoId,
          path: filePath,
        });

        const videoOps = yield* VideoOperationsService;

        const video = yield* videoOps.getVideoDeepById(parsed.videoId);

        const fileExists = yield* videoFileExists(video.lineageId, parsed.path);
        if (!fileExists) {
          return yield* Effect.die(data("File not found", { status: 404 }));
        }

        const content = yield* readVideoFile(video.lineageId, parsed.path);

        return new Response(Buffer.from(content), {
          status: 200,
          headers: {
            "Content-Type": getMimeType(parsed.path),
          },
        });
      }),
  })(args);
};
