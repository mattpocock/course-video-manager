import { Console, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.thumbnails.$thumbnailId.update";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
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

export const action = async (args: Route.ActionArgs) => {
  const { thumbnailId } = args.params;
  const body = await args.request.json();

  return Effect.gen(function* () {
    const {
      imageDataUrl,
      backgroundPhotoDataUrl,
      diagramDataUrl,
      diagramPosition,
      cutoutDataUrl,
      cutoutPosition,
    } = body;

    if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:")) {
      return yield* Effect.die(
        data("imageDataUrl is required", { status: 400 })
      );
    }

    const thumbnailOps = yield* ThumbnailOperationsService;
    const fs = yield* FileSystem.FileSystem;

    // Get existing thumbnail to find its file paths
    const existing = yield* thumbnailOps.getThumbnailById(thumbnailId);
    const existingLayers = existing.layers as {
      backgroundPhoto?: { filePath?: string };
      diagram?: { filePath?: string } | null;
      cutout?: { filePath?: string } | null;
    };

    // Overwrite composite PNG
    const compositeBytes = decodeDataUrl(imageDataUrl);
    if (existing.filePath) {
      yield* fs.writeFile(existing.filePath, compositeBytes);
    }

    // Overwrite background photo (use original captured photo, not the composite)
    if (existingLayers.backgroundPhoto?.filePath) {
      const bgBytes =
        typeof backgroundPhotoDataUrl === "string" &&
        backgroundPhotoDataUrl.startsWith("data:")
          ? decodeDataUrl(backgroundPhotoDataUrl)
          : compositeBytes;
      yield* fs.writeFile(existingLayers.backgroundPhoto.filePath, bgBytes);
    }

    // Handle diagram layer
    let diagramLayer = null;
    if (
      typeof diagramDataUrl === "string" &&
      diagramDataUrl.startsWith("data:")
    ) {
      const diagBytes = decodeDataUrl(diagramDataUrl);

      if (existingLayers.diagram?.filePath) {
        // Overwrite existing diagram file
        yield* fs.writeFile(existingLayers.diagram.filePath, diagBytes);
        diagramLayer = {
          filePath: existingLayers.diagram.filePath,
          horizontalPosition:
            typeof diagramPosition === "number" ? diagramPosition : 50,
        };
      } else {
        // New diagram — create file using thumbnail ID pattern
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
      // Diagram was removed — delete the old file
      yield* fs
        .remove(existingLayers.diagram.filePath)
        .pipe(Effect.catchAll(() => Effect.void));
    }

    // Handle cutout layer
    let cutoutLayer = null;
    if (
      typeof cutoutDataUrl === "string" &&
      cutoutDataUrl.startsWith("data:")
    ) {
      const cutoutBytes = decodeDataUrl(cutoutDataUrl);

      if (existingLayers.cutout?.filePath) {
        // Overwrite existing cutout file
        yield* fs.writeFile(existingLayers.cutout.filePath, cutoutBytes);
        cutoutLayer = {
          filePath: existingLayers.cutout.filePath,
          horizontalPosition:
            typeof cutoutPosition === "number" ? cutoutPosition : 50,
        };
      } else {
        // New cutout — create file
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
      // Cutout was removed — delete the old file
      yield* fs
        .remove(existingLayers.cutout.filePath)
        .pipe(Effect.catchAll(() => Effect.void));
    }

    // Build updated layers JSON
    const layers = {
      backgroundPhoto: existingLayers.backgroundPhoto ?? {
        filePath: existing.filePath,
        horizontalPosition: 0,
      },
      diagram: diagramLayer,
      cutout: cutoutLayer,
    };

    // Update DB record
    const updated = yield* thumbnailOps.updateThumbnail(thumbnailId, {
      layers,
      filePath: existing.filePath,
    });

    return { success: true, thumbnailId: updated.id };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Thumbnail not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
