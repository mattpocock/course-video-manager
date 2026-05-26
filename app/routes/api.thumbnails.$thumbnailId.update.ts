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
  errors: { NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const body = payload as Record<string, unknown>;
      const {
        imageDataUrl,
        backgroundPhotoDataUrl,
        diagramDataUrl,
        diagramPosition,
        cutoutDataUrl,
        cutoutPosition,
      } = body;

      if (
        typeof imageDataUrl !== "string" ||
        !imageDataUrl.startsWith("data:")
      ) {
        return yield* Effect.die(
          data("imageDataUrl is required", { status: 400 })
        );
      }

      const thumbnailId = params.thumbnailId!;
      const thumbnailOps = yield* ThumbnailOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const existing = yield* thumbnailOps.getThumbnailById(thumbnailId);
      const existingLayers = existing.layers as {
        backgroundPhoto?: { filePath?: string };
        diagram?: { filePath?: string } | null;
        cutout?: { filePath?: string } | null;
      };

      const compositeBytes = decodeDataUrl(imageDataUrl as string);
      if (existing.filePath) {
        yield* fs.writeFile(existing.filePath, compositeBytes);
      }

      if (existingLayers.backgroundPhoto?.filePath) {
        const bgBytes =
          typeof backgroundPhotoDataUrl === "string" &&
          backgroundPhotoDataUrl.startsWith("data:")
            ? decodeDataUrl(backgroundPhotoDataUrl)
            : compositeBytes;
        yield* fs.writeFile(existingLayers.backgroundPhoto.filePath, bgBytes);
      }

      let diagramLayer = null;
      if (
        typeof diagramDataUrl === "string" &&
        diagramDataUrl.startsWith("data:")
      ) {
        const diagBytes = decodeDataUrl(diagramDataUrl);

        if (existingLayers.diagram?.filePath) {
          yield* fs.writeFile(existingLayers.diagram.filePath, diagBytes);
          diagramLayer = {
            filePath: existingLayers.diagram.filePath,
            horizontalPosition:
              typeof diagramPosition === "number" ? diagramPosition : 50,
          };
        } else {
          const diagFilename = `thumbnail-${thumbnailId}-diagram.png`;
          const diagFilePath = getStandaloneVideoFilePath(
            existing.videoId,
            diagFilename
          );
          yield* fs.writeFile(diagFilePath, diagBytes);
          diagramLayer = {
            filePath: diagFilePath,
            horizontalPosition:
              typeof diagramPosition === "number" ? diagramPosition : 50,
          };
        }
      } else if (existingLayers.diagram?.filePath) {
        yield* fs
          .remove(existingLayers.diagram.filePath)
          .pipe(Effect.catchAll(() => Effect.void));
      }

      let cutoutLayer = null;
      if (
        typeof cutoutDataUrl === "string" &&
        cutoutDataUrl.startsWith("data:")
      ) {
        const cutoutBytes = decodeDataUrl(cutoutDataUrl);

        if (existingLayers.cutout?.filePath) {
          yield* fs.writeFile(existingLayers.cutout.filePath, cutoutBytes);
          cutoutLayer = {
            filePath: existingLayers.cutout.filePath,
            horizontalPosition:
              typeof cutoutPosition === "number" ? cutoutPosition : 50,
          };
        } else {
          const cutoutFilename = `thumbnail-${thumbnailId}-cutout.png`;
          const cutoutFilePath = getStandaloneVideoFilePath(
            existing.videoId,
            cutoutFilename
          );
          yield* fs.writeFile(cutoutFilePath, cutoutBytes);
          cutoutLayer = {
            filePath: cutoutFilePath,
            horizontalPosition:
              typeof cutoutPosition === "number" ? cutoutPosition : 50,
          };
        }
      } else if (existingLayers.cutout?.filePath) {
        yield* fs
          .remove(existingLayers.cutout.filePath)
          .pipe(Effect.catchAll(() => Effect.void));
      }

      const layers = {
        backgroundPhoto: existingLayers.backgroundPhoto ?? {
          filePath: existing.filePath,
          horizontalPosition: 0,
        },
        diagram: diagramLayer,
        cutout: cutoutLayer,
      };

      const updated = yield* thumbnailOps.updateThumbnail(thumbnailId, {
        layers,
        filePath: existing.filePath,
      });

      return { success: true, thumbnailId: updated.id };
    }),
});
