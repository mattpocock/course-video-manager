import { useRef } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { useRevalidator } from "react-router";
import { toast } from "@/components/ui/toast";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
  type ThumbnailDiagramDocument,
} from "@/features/thumbnail-editor/thumbnail-state-reducer";
import type { ThumbnailEditorHistory } from "@/features/thumbnail-editor/thumbnail-face-history";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

interface StoredLayer {
  filePath: string;
  horizontalPosition: number;
}

/**
 * The `layers` JSON a thumbnail row stores: file paths and slider positions.
 * Not the same as the compositor's `ThumbnailLayers`, which holds the loaded
 * images.
 */
interface StoredThumbnailLayers {
  backgroundPhoto: StoredLayer;
  diagram: StoredLayer | null;
  cutout: StoredLayer | null;
}

interface Thumbnail {
  id: string;
  layers: unknown;
  /** The stored tldraw `document`, or null (ADR 0060). */
  thumbnailDiagram: unknown;
}

export function useThumbnailReducer(thumbnails: Thumbnail[]) {
  const revalidator = useRevalidator();
  // The mounted thumbnail editor's undo history; null without an editor
  // (an old pasted-PNG Thumbnail), which then opens with the reducer's face.
  const editorHistory = useRef<ThumbnailEditorHistory | null>(null);

  const [state, dispatch] = useEffectReducer<
    thumbnailStateReducer.State,
    thumbnailStateReducer.Action,
    thumbnailStateReducer.Effect
  >(thumbnailStateReducer, createInitialThumbnailState(), {
    "remove-background": (_state, effect, dispatch) => {
      fetch("/api/remove-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: effect.dataUrl }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Background removal failed");
          const result = await response.json();
          dispatch({
            type: "background-removal-succeeded",
            dataUrl: result.imageDataUrl,
          });
        })
        .catch((error) => {
          console.error("Background removal failed:", error);
          dispatch({
            type: "background-removal-failed",
            error:
              "Background removal failed. You can retry or continue without it.",
          });
        });
    },
    "record-face": (_state, effect) => {
      editorHistory.current?.recordFace(effect.face, effect.history);
    },
    "save-thumbnail": (_state, effect, dispatch) => {
      const payload = {
        videoId: effect.videoId,
        imageDataUrl: effect.compositeDataUrl,
        backgroundPhotoDataUrl: effect.capturedPhoto,
        diagramDataUrl: effect.diagramImage,
        diagramPosition: effect.diagramImage
          ? effect.diagramPosition
          : undefined,
        cutoutDataUrl: effect.cutoutImage,
        cutoutPosition: effect.cutoutImage ? effect.cutoutPosition : undefined,
        thumbnailDiagram: effect.thumbnailDiagram,
        diagramSources: effect.diagramSources,
      };

      fetch(
        effect.editingThumbnailId
          ? `/api/thumbnails/${effect.editingThumbnailId}/update`
          : "/api/thumbnails/create",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
        .then(async (response) => {
          if (!response.ok) throw new Error("Failed to save thumbnail");
          const result = await response.json();
          dispatch({
            type: "save-succeeded",
            thumbnailId: result.thumbnailId,
          });
        })
        .catch((error) => {
          console.error("Failed to save thumbnail:", error);
          dispatch({ type: "save-failed" });
        });
    },
    "delete-thumbnail": (_state, effect, dispatch) => {
      fetch(`/api/thumbnails/${effect.thumbnailId}/delete`, {
        method: "POST",
      })
        .then((response) => {
          if (!response.ok) throw new Error("Failed to delete thumbnail");
          dispatch({ type: "delete-succeeded" });
        })
        .catch((error) => {
          console.error("Failed to delete thumbnail:", error);
          dispatch({ type: "delete-failed" });
        });
    },
    "load-thumbnail": (_state, effect, dispatch) => {
      const thumbnail = thumbnails.find((t) => t.id === effect.thumbnailId);
      if (!thumbnail) {
        dispatch({ type: "edit-failed" });
        return;
      }

      const layers = thumbnail.layers as StoredThumbnailLayers;

      Promise.all([
        // Fetch background photo
        fetch(`/api/thumbnails/${effect.thumbnailId}/layer/bg`)
          .then((r) => {
            if (!r.ok) throw new Error("Failed to load background");
            return r.blob();
          })
          .then(blobToDataUrl),
        // Fetch diagram if exists
        layers.diagram
          ? fetch(`/api/thumbnails/${effect.thumbnailId}/layer/diagram`)
              .then((r) => (r.ok ? r.blob() : null))
              .then((b) => (b ? blobToDataUrl(b) : null))
          : Promise.resolve(null),
        // Fetch cutout if exists
        layers.cutout
          ? fetch(`/api/thumbnails/${effect.thumbnailId}/layer/cutout`)
              .then((r) => (r.ok ? r.blob() : null))
              .then((b) => (b ? blobToDataUrl(b) : null))
          : Promise.resolve(null),
      ])
        .then(([bgDataUrl, diagDataUrl, cutDataUrl]) => {
          dispatch({
            type: "edit-loaded",
            thumbnailId: effect.thumbnailId,
            capturedPhoto: bgDataUrl,
            diagramImage: diagDataUrl,
            diagramPosition: layers.diagram?.horizontalPosition ?? 50,
            cutoutImage: cutDataUrl,
            cutoutPosition: layers.cutout?.horizontalPosition ?? 50,
            // Written only by this page's save, as a tldraw `document`.
            thumbnailDiagram:
              thumbnail.thumbnailDiagram as ThumbnailDiagramDocument | null,
          });
        })
        .catch((error) => {
          console.error("Failed to load thumbnail for editing:", error);
          dispatch({ type: "edit-failed" });
        });
    },
    revalidate: () => {
      revalidator.revalidate().catch(() => {
        toast.error("Failed to refresh the thumbnails");
      });
    },
  });

  return { state, dispatch, editorHistory };
}
