import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { useRevalidator } from "react-router";
import { toast } from "@/components/ui/toast";
import {
  thumbnailStateReducer,
  createInitialThumbnailState,
  selectPendingSave,
} from "@/features/thumbnail-editor/thumbnail-state-reducer";
import type { ThumbnailEditorHistory } from "@/features/thumbnail-editor/thumbnail-face-history";
import type { ThumbnailDiagramDocument } from "@cvm/core/lib/thumbnail-diagram";

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
  thumbnailDiagram: ThumbnailDiagramDocument | null;
}

type SaveThumbnail = Extract<
  thumbnailStateReducer.Effect,
  { type: "save-thumbnail" }
>;

/** Sends one save; resolves with the saved Thumbnail's id. */
async function postSave(effect: SaveThumbnail): Promise<string> {
  const payload = {
    videoId: effect.videoId,
    imageDataUrl: effect.compositeDataUrl,
    backgroundPhotoDataUrl: effect.capturedPhoto,
    diagramDataUrl: effect.diagramImage,
    diagramPosition: effect.diagramImage ? effect.diagramPosition : undefined,
    cutoutDataUrl: effect.cutoutImage,
    cutoutPosition: effect.cutoutImage ? effect.cutoutPosition : undefined,
    thumbnailDiagram: effect.thumbnailDiagram,
    diagramSources: effect.diagramSources,
  };
  const response = await fetch(
    effect.editingThumbnailId
      ? `/api/thumbnails/${effect.editingThumbnailId}/update`
      : "/api/thumbnails/create",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) throw new Error("Failed to save thumbnail");
  const result: { thumbnailId: string } = await response.json();
  return result.thumbnailId;
}

/**
 * Saves an edit still waiting for its autosave when the page goes: on
 * `pagehide` through the reducer, and on unmount (the reducer is gone) from
 * here. A whole save's PNGs are too big for a keepalive request, which is
 * all that outlives a closing tab, so on `pagehide` the insert sources (which
 * live nowhere else) also go alone, with keepalive.
 */
function useSaveOnLeave(
  state: thumbnailStateReducer.State,
  videoId: string,
  dispatch: (action: thumbnailStateReducer.Action) => void
) {
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  useEffect(() => {
    const onPageHide = () => {
      const leaving = selectPendingSave(latest.current, videoId);
      if (!leaving) return;
      if (leaving.editingThumbnailId && leaving.diagramSources.length > 0) {
        void fetch(`/api/thumbnails/${leaving.editingThumbnailId}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diagramSources: leaving.diagramSources }),
          keepalive: true,
        }).catch(() => undefined);
      }
      // Synchronous, so the save's request starts before the page freezes.
      flushSync(() => dispatch({ type: "page-hidden", videoId }));
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      const leaving = selectPendingSave(latest.current, videoId);
      if (leaving) {
        postSave(leaving).catch(() => {
          toast.error("Failed to save the thumbnail you left");
        });
      }
    };
  }, [videoId, dispatch]);
}

export function useThumbnailReducer(
  videoId: string,
  thumbnails: Thumbnail[],
  drawsNewThumbnails: boolean
) {
  const revalidator = useRevalidator();
  // The mounted thumbnail editor's undo history; null without an editor
  // (an old pasted-PNG Thumbnail), which then opens with the reducer's face.
  const editorHistory = useRef<ThumbnailEditorHistory | null>(null);

  // Feature flag plumbing: the page's loader reads the flag.
  const initialState = { ...createInitialThumbnailState(), drawsNewThumbnails };
  const [state, dispatch] = useEffectReducer<
    thumbnailStateReducer.State,
    thumbnailStateReducer.Action,
    thumbnailStateReducer.Effect
  >(thumbnailStateReducer, initialState, {
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
      postSave(effect)
        .then((thumbnailId) => {
          dispatch({
            type: "save-succeeded",
            thumbnailId,
            diagramSession: effect.diagramSession,
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
            videoId,
            capturedPhoto: bgDataUrl,
            diagramImage: diagDataUrl,
            diagramPosition: layers.diagram?.horizontalPosition ?? 50,
            cutoutImage: cutDataUrl,
            cutoutPosition: layers.cutout?.horizontalPosition ?? 50,
            thumbnailDiagram: thumbnail.thumbnailDiagram,
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

  useSaveOnLeave(state, videoId, dispatch);

  return { state, dispatch, editorHistory };
}
