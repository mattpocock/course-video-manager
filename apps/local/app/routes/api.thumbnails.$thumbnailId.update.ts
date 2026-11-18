import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeAction } from "@/services/route-action.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  removeStoredVideoFile,
  videoFileRelativePathOf,
  videoFileRowPath,
  writeVideoFile,
} from "@/services/video-files";
import { data } from "react-router";
import { readThumbnailDiagramField } from "@/features/thumbnail-editor/thumbnail-diagram-payload";

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
        thumbnailDiagram: thumbnailDiagramField,
      } = body;

      if (
        typeof imageDataUrl !== "string" ||
        !imageDataUrl.startsWith("data:")
      ) {
        return yield* Effect.die(
          data("imageDataUrl is required", { status: 400 })
        );
      }

      const thumbnailDiagram = readThumbnailDiagramField(thumbnailDiagramField);
      if (thumbnailDiagram === undefined) {
        return yield* Effect.die(
          data("thumbnailDiagram must be a tldraw document or null", {
            status: 400,
          })
        );
      }

      const thumbnailId = params.thumbnailId!;
      const thumbnailOps = yield* ThumbnailOperationsService;
      const videoOps = yield* VideoOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const existing = yield* thumbnailOps.getThumbnailById(thumbnailId);
      const video = yield* videoOps.getVideoDeepById(existing.videoId);
      const existingLayers = existing.layers as {
        backgroundPhoto?: { filePath?: string; horizontalPosition?: number };
        diagram?: { filePath?: string } | null;
        cutout?: { filePath?: string } | null;
      };

      // Every PNG is written as a Video File on the first Storage Root, and
      // the row stores its root-relative path. A stored path in this Video's
      // directory in any store keeps its name (a duplicated Thumbnail's PNG
      // is named after its source's id); its older copy elsewhere is removed.
      // A stored path in no store (on a verify-cvm clone the row still names
      // Matt's real file; a broken `.worktrees` path) is never written: the
      // layer moves to its canonical name instead.
      const writeLayer = (
        stored: string | null | undefined,
        suffix: string,
        bytes: Uint8Array
      ) =>
        Effect.gen(function* () {
          const relativePath =
            (stored && videoFileRelativePathOf(stored, video.lineageId)) ||
            `thumbnail-${thumbnailId}${suffix}.png`;
          yield* writeVideoFile(video.lineageId, relativePath, bytes);
          return videoFileRowPath(video.lineageId, relativePath);
        });

      const compositeBytes = decodeDataUrl(imageDataUrl as string);
      const compositePath = yield* writeLayer(
        existing.filePath,
        "",
        compositeBytes
      );

      // A thumbnail made before layers existed has no background file of its
      // own: its composite stands in for it, as it always has.
      let bgPath = compositePath;
      if (existingLayers.backgroundPhoto?.filePath) {
        bgPath = yield* writeLayer(
          existingLayers.backgroundPhoto.filePath,
          "-bg",
          typeof backgroundPhotoDataUrl === "string" &&
            backgroundPhotoDataUrl.startsWith("data:")
            ? decodeDataUrl(backgroundPhotoDataUrl)
            : compositeBytes
        );
      }

      let diagramLayer = null;
      if (
        typeof diagramDataUrl === "string" &&
        diagramDataUrl.startsWith("data:")
      ) {
        diagramLayer = {
          filePath: yield* writeLayer(
            existingLayers.diagram?.filePath,
            "-diagram",
            decodeDataUrl(diagramDataUrl)
          ),
          horizontalPosition:
            typeof diagramPosition === "number" ? diagramPosition : 50,
        };
      } else if (existingLayers.diagram?.filePath) {
        yield* removeStoredVideoFile(fs, existingLayers.diagram.filePath);
      }

      let cutoutLayer = null;
      if (
        typeof cutoutDataUrl === "string" &&
        cutoutDataUrl.startsWith("data:")
      ) {
        cutoutLayer = {
          filePath: yield* writeLayer(
            existingLayers.cutout?.filePath,
            "-cutout",
            decodeDataUrl(cutoutDataUrl)
          ),
          horizontalPosition:
            typeof cutoutPosition === "number" ? cutoutPosition : 50,
        };
      } else if (existingLayers.cutout?.filePath) {
        yield* removeStoredVideoFile(fs, existingLayers.cutout.filePath);
      }

      const layers = {
        backgroundPhoto: {
          horizontalPosition: 0,
          ...existingLayers.backgroundPhoto,
          filePath: bgPath,
        },
        diagram: diagramLayer,
        cutout: cutoutLayer,
      };

      const updated = yield* thumbnailOps.updateThumbnail(thumbnailId, {
        layers,
        filePath: compositePath,
        thumbnailDiagram,
      });

      return { success: true, thumbnailId: updated.id };
    }),
});
