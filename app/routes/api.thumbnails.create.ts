import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeAction } from "@/services/route-action.server";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { data } from "react-router";

function decodeDataUrl(dataUrl: string): Uint8Array {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !match[2]) {
    throw new Error("Invalid base64 data URL format");
  }
  const binaryString = atob(match[2]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const action = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const {
        videoId,
        imageDataUrl,
        backgroundPhotoDataUrl,
        diagramDataUrl,
        diagramPosition,
        cutoutDataUrl,
        cutoutPosition,
      } = payload as any;

      if (typeof videoId !== "string" || !videoId) {
        return yield* Effect.die(data("videoId is required", { status: 400 }));
      }
      if (
        typeof imageDataUrl !== "string" ||
        !imageDataUrl.startsWith("data:")
      ) {
        return yield* Effect.die(
          data("imageDataUrl is required", { status: 400 })
        );
      }

      const thumbnailOps = yield* ThumbnailOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const compositeBytes = decodeDataUrl(imageDataUrl);

      const thumbnailId = crypto.randomUUID();
      const filename = `thumbnail-${thumbnailId}.png`;
      const videoDir = getStandaloneVideoFilePath(videoId);
      const filePath = getStandaloneVideoFilePath(videoId, filename);

      const dirExists = yield* fs.exists(videoDir);
      if (!dirExists) {
        yield* fs.makeDirectory(videoDir, { recursive: true });
      }

      yield* fs.writeFile(filePath, compositeBytes);

      const bgFilename = `thumbnail-${thumbnailId}-bg.png`;
      const bgFilePath = getStandaloneVideoFilePath(videoId, bgFilename);
      const bgBytes =
        typeof backgroundPhotoDataUrl === "string" &&
        backgroundPhotoDataUrl.startsWith("data:")
          ? decodeDataUrl(backgroundPhotoDataUrl)
          : compositeBytes;
      yield* fs.writeFile(bgFilePath, bgBytes);

      let diagramLayer = null;
      if (
        typeof diagramDataUrl === "string" &&
        diagramDataUrl.startsWith("data:")
      ) {
        const diagBytes = decodeDataUrl(diagramDataUrl);
        const diagFilename = `thumbnail-${thumbnailId}-diagram.png`;
        const diagFilePath = getStandaloneVideoFilePath(videoId, diagFilename);
        yield* fs.writeFile(diagFilePath, diagBytes);

        diagramLayer = {
          filePath: diagFilePath,
          horizontalPosition:
            typeof diagramPosition === "number" ? diagramPosition : 50,
        };
      }

      let cutoutLayer = null;
      if (
        typeof cutoutDataUrl === "string" &&
        cutoutDataUrl.startsWith("data:")
      ) {
        const cutoutBytes = decodeDataUrl(cutoutDataUrl);
        const cutoutFilename = `thumbnail-${thumbnailId}-cutout.png`;
        const cutoutFilePath = getStandaloneVideoFilePath(
          videoId,
          cutoutFilename
        );
        yield* fs.writeFile(cutoutFilePath, cutoutBytes);

        cutoutLayer = {
          filePath: cutoutFilePath,
          horizontalPosition:
            typeof cutoutPosition === "number" ? cutoutPosition : 50,
        };
      }

      const layers = {
        backgroundPhoto: {
          filePath: bgFilePath,
          horizontalPosition: 0,
        },
        diagram: diagramLayer,
        cutout: cutoutLayer,
      };

      const thumbnail = yield* thumbnailOps.createThumbnail({
        videoId,
        layers,
        filePath,
      });

      return { success: true, thumbnailId: thumbnail.id };
    }),
});
