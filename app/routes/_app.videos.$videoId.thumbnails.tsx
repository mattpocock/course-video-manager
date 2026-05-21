export const handle = { fullscreen: true };

import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import { data, Link } from "react-router";
import type { Route } from "./+types/_app.videos.$videoId.thumbnails";
import {
  CameraIcon,
  ImageIcon,
  Loader2Icon,
  ClipboardIcon,
  XIcon,
  Trash2Icon,
  PlusIcon,
  ScissorsIcon,
  AlertCircleIcon,
  ArrowLeftIcon,
  DownloadIcon,
  PencilIcon,
} from "lucide-react";
import { useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Label } from "@/components/ui/label";
import { CaptureCameraModal } from "@/components/capture-camera-modal";
import { useThumbnailReducer } from "@/hooks/use-thumbnail-reducer";
import {
  composeThumbnailLayers,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  getLeftAlignedPosition,
} from "@/features/thumbnail-editor/canvas-compositor";
import { RuleOfThirdsGrid } from "@/features/thumbnail-editor/rule-of-thirds-grid";

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const thumbnails = yield* db.getThumbnailsByVideoId(videoId);

    return { videoId, thumbnails };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

function YouTubePreview({
  src,
  width,
  height,
  label,
}: {
  src: string;
  width: number;
  height: number;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="relative" style={{ width, height }}>
        <img
          src={src}
          alt={`${label} preview`}
          className="rounded-lg object-cover"
          style={{ width, height }}
        />
        {/* Mock YouTube timestamp badge */}
        <div className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-xs font-medium leading-none text-white">
          12:34
        </div>
      </div>
    </div>
  );
}

export default function ThumbnailsPage({ loaderData }: Route.ComponentProps) {
  const { videoId, thumbnails } = loaderData;
  const { state, dispatch } = useThumbnailReducer(thumbnails);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw all layers onto the canvas compositor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !(state.capturedPhoto || state.diagramImage)) {
      dispatch({ type: "preview-updated", dataUrl: null });
      return;
    }

    const signal = { cancelled: false };

    composeThumbnailLayers(
      canvas,
      {
        capturedPhoto: state.capturedPhoto,
        diagramImage: state.diagramImage,
        diagramPosition: state.diagramPosition,
        cutoutImage: state.cutoutImage,
        cutoutPosition: state.cutoutPosition,
      },
      signal
    ).then((dataUrl) => {
      if (!signal.cancelled) {
        dispatch({ type: "preview-updated", dataUrl });
      }
    });

    return () => {
      signal.cancelled = true;
    };
  }, [
    state.capturedPhoto,
    state.diagramImage,
    state.diagramPosition,
    state.cutoutImage,
    state.cutoutPosition,
    dispatch,
  ]);

  // Handle clipboard paste for diagram images
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.type.startsWith("image/")) continue;

        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new Image();
            img.onload = () => {
              dispatch({
                type: "diagram-pasted",
                dataUrl,
                position: getLeftAlignedPosition(
                  img.naturalWidth,
                  img.naturalHeight
                ),
              });
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    },
    [dispatch]
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // Auto-save when pendingAutoSave is set (debounced for slider drags)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (
      !state.pendingAutoSave ||
      !state.previewDataUrl ||
      state.saving ||
      !canvas
    )
      return;

    const timer = setTimeout(() => {
      dispatch({
        type: "save-requested",
        videoId,
        compositeDataUrl: canvas.toDataURL("image/png"),
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [
    state.pendingAutoSave,
    state.previewDataUrl,
    state.saving,
    videoId,
    dispatch,
  ]);

  const handleDelete = (thumbnailId: string) => {
    if (!confirm("Delete this thumbnail?")) return;
    dispatch({ type: "delete-requested", thumbnailId });
  };

  return (
    <div className="flex h-full">
      {/* Left sidebar: saved thumbnails */}
      {thumbnails.length > 0 && (
        <div className="w-48 shrink-0 border-r overflow-y-auto p-3">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Saved ({thumbnails.length})
          </h3>
          <div className="space-y-2">
            {thumbnails.map((thumbnail) => (
              <ContextMenu key={thumbnail.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={`group relative rounded-lg overflow-hidden cursor-pointer transition-all ${
                      state.editingThumbnailId === thumbnail.id
                        ? "ring-2 ring-ring border border-ring"
                        : "border hover:border-border"
                    }`}
                    onClick={() =>
                      dispatch({
                        type: "edit-requested",
                        thumbnailId: thumbnail.id,
                      })
                    }
                  >
                    {thumbnail.filePath ? (
                      <img
                        src={`/api/thumbnails/${thumbnail.id}/image`}
                        alt="Thumbnail"
                        className="w-full aspect-video object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-video bg-card flex items-center justify-center text-muted-foreground text-xs">
                        Not rendered
                      </div>
                    )}
                    {state.loadingEdit === thumbnail.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2Icon className="size-4 animate-spin text-white" />
                      </div>
                    )}
                    {state.deleting === thumbnail.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2Icon className="size-4 animate-spin text-white" />
                      </div>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {thumbnail.filePath && (
                    <>
                      <ContextMenuItem
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = `/api/thumbnails/${thumbnail.id}/image`;
                          a.download = `thumbnail-${thumbnail.id}.png`;
                          a.click();
                        }}
                      >
                        <DownloadIcon className="size-4" />
                        Download
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}
                  <ContextMenuItem
                    onClick={() =>
                      dispatch({
                        type: "edit-requested",
                        thumbnailId: thumbnail.id,
                      })
                    }
                  >
                    <PencilIcon className="size-4" />
                    Edit
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => handleDelete(thumbnail.id)}
                  >
                    <Trash2Icon className="size-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
          <button
            className="mt-2 flex w-full items-center justify-center rounded-lg border border-dashed border-border p-2 text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors"
            onClick={() => dispatch({ type: "new-thumbnail-clicked" })}
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to={`/videos/${videoId}/post`}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeftIcon className="size-4" />
              Post
            </Link>
            <h2 className="text-xl font-semibold">Thumbnails</h2>
          </div>
          <Button onClick={() => dispatch({ type: "open-camera" })}>
            <CameraIcon />
            Capture Face
          </Button>
        </div>

        {(state.capturedPhoto || state.diagramImage) && (
          <div className="mb-6">
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              {state.editingThumbnailId
                ? "Editing Thumbnail"
                : "Canvas Preview"}
            </h3>
            <div className="relative inline-block overflow-hidden rounded-lg border">
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="h-auto max-w-2xl w-full"
              />
              <RuleOfThirdsGrid width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
            </div>
            {/* Layer controls */}
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Layers
              </h3>

              {/* Background layer */}
              {state.capturedPhoto ? (
                <div className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <ImageIcon className="size-4 text-muted-foreground" />
                  <span>Background Photo</span>
                </div>
              ) : (
                <button
                  onClick={() => dispatch({ type: "open-camera" })}
                  className="flex w-full items-center gap-2 rounded border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-muted-foreground hover:text-muted-foreground"
                >
                  <CameraIcon className="size-4" />
                  <span>Capture a face photo</span>
                </button>
              )}

              {/* Diagram layer */}
              {state.diagramImage ? (
                <div className="rounded border px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <ClipboardIcon className="size-4 text-muted-foreground" />
                      <span>Diagram</span>
                    </div>
                    <button
                      onClick={() => dispatch({ type: "diagram-removed" })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2">
                    <Label className="text-xs text-muted-foreground">
                      Horizontal Position
                    </Label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={state.diagramPosition}
                      onChange={(e) =>
                        dispatch({
                          type: "diagram-position-changed",
                          value: Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  <ClipboardIcon className="size-4" />
                  <span>Paste a diagram from clipboard (Ctrl+V)</span>
                </div>
              )}

              {/* Cutout layer */}
              {state.removingBackground ? (
                <div className="flex items-center gap-2 rounded border px-3 py-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  <span>Removing background...</span>
                </div>
              ) : state.backgroundRemovalError ? (
                <div className="rounded border border-destructive/50 px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircleIcon className="size-4" />
                      <span>Cutout</span>
                    </div>
                    <button
                      onClick={() =>
                        dispatch({ type: "retry-background-removal" })
                      }
                      className="text-xs text-destructive hover:text-destructive/80 underline"
                    >
                      Retry
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-destructive/70">
                    {state.backgroundRemovalError}
                  </p>
                </div>
              ) : state.cutoutImage ? (
                <div className="rounded border px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <ScissorsIcon className="size-4 text-muted-foreground" />
                      <span>Cutout</span>
                    </div>
                    <button
                      onClick={() => dispatch({ type: "cutout-removed" })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2">
                    <Label className="text-xs text-muted-foreground">
                      Horizontal Position
                    </Label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={state.cutoutPosition}
                      onChange={(e) =>
                        dispatch({
                          type: "cutout-position-changed",
                          value: Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  <ScissorsIcon className="size-4" />
                  <span>No cutout layer</span>
                </div>
              )}
            </div>

            {/* YouTube size previews */}
            {state.previewDataUrl && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                  YouTube Previews
                </h3>
                <div className="flex items-end gap-4">
                  <YouTubePreview
                    src={state.previewDataUrl}
                    width={360}
                    height={202}
                    label="Home Feed"
                  />
                  <YouTubePreview
                    src={state.previewDataUrl}
                    width={246}
                    height={138}
                    label="Search Results"
                  />
                  <YouTubePreview
                    src={state.previewDataUrl}
                    width={168}
                    height={94}
                    label="Sidebar"
                  />
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              {state.saving && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  <span>Saving...</span>
                </div>
              )}
              {state.editingThumbnailId && (
                <Button
                  variant="outline"
                  onClick={() => dispatch({ type: "new-thumbnail-clicked" })}
                >
                  <PlusIcon />
                  New Thumbnail
                </Button>
              )}
            </div>
          </div>
        )}

        {thumbnails.length === 0 &&
          !state.capturedPhoto &&
          !state.diagramImage && (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
              <ImageIcon className="size-16 opacity-50" />
              <div className="text-center">
                <p className="text-lg font-medium">No thumbnails yet</p>
                <p className="text-sm mt-1">
                  Capture a face photo or paste a diagram to start creating
                  thumbnails.
                </p>
              </div>
            </div>
          )}
      </div>

      <CaptureCameraModal
        open={state.cameraOpen}
        onOpenChange={(open) =>
          dispatch({ type: open ? "open-camera" : "close-camera" })
        }
        onCapture={(dataUrl) => dispatch({ type: "photo-captured", dataUrl })}
      />
    </div>
  );
}
