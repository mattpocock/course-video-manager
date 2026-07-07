import { Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.lesson-files.read";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { data } from "react-router";
import path from "path";
import { getVideoFilePath } from "@/services/video-files";

const readFileSchema = Schema.Struct({
  videoId: Schema.String,
  filePath: Schema.String,
});

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    xml: "application/xml",
    csv: "text/csv",
    js: "text/javascript",
    ts: "text/typescript",
    jsx: "text/javascript",
    tsx: "text/typescript",
    html: "text/html",
    css: "text/css",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const videoId = url.searchParams.get("videoId");
  const filePathParam = url.searchParams.get("filePath");

  return makeLoader({
    effect: () =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknown(readFileSchema)({
          videoId,
          filePath: filePathParam,
        });

        const videoOps = yield* VideoOperationsService;
        const fs = yield* FileSystem.FileSystem;

        const video = yield* videoOps.getVideoWithClipsById(parsed.videoId);

        const videoDir = getVideoFilePath(video.lineageId);
        const fullFilePath = path.join(videoDir, parsed.filePath);

        const fileExists = yield* fs.exists(fullFilePath);
        if (!fileExists) {
          return yield* Effect.die(data("File not found", { status: 404 }));
        }

        const content = yield* fs.readFile(fullFilePath);

        const mimeType = getMimeType(parsed.filePath);

        return new Response(Buffer.from(content), {
          status: 200,
          headers: {
            "Content-Type": mimeType,
          },
        });
      }),
  })(args);
};
