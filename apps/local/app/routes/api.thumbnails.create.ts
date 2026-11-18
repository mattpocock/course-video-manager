import { Effect } from "effect";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeAction } from "@/services/route-action.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { videoFileRowPath, writeVideoFile } from "@/services/video-files";
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

/**
 * The JSON body this route accepts. Every field is `unknown` because it comes
 * off the wire unvalidated — the `typeof` checks below are what narrow it.
 */
interface CreateThumbnailPayload {
  videoId?: unknown;
  imageDataUrl?: unknown;
  backgroundPhotoDataUrl?: unknown;
  diagramDataUrl?: unknown;
  diagramPosition?: unknown;
  cutoutDataUrl?: unknown;
  cutoutPosition?: unknown;
  thumbnailDiagram?: unknown;
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
        thumbnailDiagram: thumbnailDiagramField,
      } = (payload ?? {}) as CreateThumbnailPayload;

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

      const thumbnailDiagram = readThumbnailDiagramField(thumbnailDiagramField);
      if (thumbnailDiagram === undefined) {
        return yield* Effect.die(
          data("thumbnailDiagram must be a tldraw document or null", {
            status: 400,
          })
        );
      }

      const thumbnailOps = yield* ThumbnailOperationsService;
      const videoOps = yield* VideoOperationsService;

      const video = yield* videoOps.getVideoDeepById(videoId);
      const thumbnailId = crypto.randomUUID();

      // Each PNG is a Video File, written on the first Storage Root; the row
      // stores its root-relative path (`video-files/{lineageId}/…`).
      const writeLayer = (suffix: string, bytes: Uint8Array) =>
        Effect.gen(function* () {
          const filename = `thumbnail-${thumbnailId}${suffix}.png`;
          yield* writeVideoFile(video.lineageId, filename, bytes);
          return videoFileRowPath(video.lineageId, filename);
        });

      const compositeBytes = decodeDataUrl(imageDataUrl);
      const filePath = yield* writeLayer("", compositeBytes);

      const bgFilePath = yield* writeLayer(
        "-bg",
        typeof backgroundPhotoDataUrl === "string" &&
          backgroundPhotoDataUrl.startsWith("data:")
          ? decodeDataUrl(backgroundPhotoDataUrl)
          : compositeBytes
      );

      let diagramLayer = null;
      if (
        typeof diagramDataUrl === "string" &&
        diagramDataUrl.startsWith("data:")
      ) {
        diagramLayer = {
          filePath: yield* writeLayer(
            "-diagram",
            decodeDataUrl(diagramDataUrl)
          ),
          horizontalPosition:
            typeof diagramPosition === "number" ? diagramPosition : 50,
        };
      }

      let cutoutLayer = null;
      if (
        typeof cutoutDataUrl === "string" &&
        cutoutDataUrl.startsWith("data:")
      ) {
        cutoutLayer = {
          filePath: yield* writeLayer("-cutout", decodeDataUrl(cutoutDataUrl)),
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
        thumbnailDiagram,
      });

      return { success: true, thumbnailId: thumbnail.id };
    }),
});
