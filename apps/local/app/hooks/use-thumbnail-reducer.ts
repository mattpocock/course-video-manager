import { useEffectReducer } from "use-effect-reducer";
import { useRevalidator } from "react-router";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
} from "@/features/thumbnail-editor/thumbnail-state-reducer";
import type { ThumbnailLayers } from "@/services/thumbnail-schema";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

interface Thumbnail {
  id: string;
  layers: unknown;
}

export function useThumbnailReducer(thumbnails: Thumbnail[]) {
  const revalidator = useRevalidator();

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
      };

      const url = effect.editingThumbnailId
        ? `/api/thumbnails/${effect.editingThumbnailId}/update`
        : "/api/thumbnails/create";

      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
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

      const layers = thumbnail.layers as unknown as ThumbnailLayers;

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
          });
        })
        .catch((error) => {
          console.error("Failed to load thumbnail for editing:", error);
          dispatch({ type: "edit-failed" });
        });
    },
    revalidate: () => {
      revalidator.revalidate();
    },
  });

  return { state, dispatch };
}
