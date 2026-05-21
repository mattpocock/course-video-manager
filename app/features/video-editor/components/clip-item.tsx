import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilmIcon,
  ImageIcon,
  Loader2,
  PauseIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  Workflow,
  XIcon,
} from "lucide-react";
import type { Clip } from "../clip-state-reducer";
import { VideoEditorContext } from "../video-editor-context";
import { useContextSelector } from "use-context-selector";
import {
  DANGEROUS_TEXT_SIMILARITY_THRESHOLD,
  getClipPercentComplete,
  getIsClipPortrait,
} from "../video-editor-selectors";
import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import {
  useDiagramSnapshotMeta,
  fetchMeta,
} from "@/features/diagrams/use-diagram-snapshot-scene";
import { resolveForClip } from "@/lib/diagram-action-resolver";
import {
  openPlayground,
  openPlaygroundWithDiagram,
} from "@/lib/diagram-window";

/**
 * Props for the ClipItem component
 */
export type ClipItemProps = {
  clip: Clip;
  isFirstItem: boolean;
  isLastItem: boolean;
  timecode: string;
  nextLevenshtein: number;
  onAddChapterBefore: () => void;
  onAddChapterAfter: () => void;
};

/**
 * Individual clip item in the timeline with thumbnail, transcript, and context menu
 */
export const ClipItem = (props: ClipItemProps) => {
  const {
    clip,
    isFirstItem,
    isLastItem,
    timecode,
    nextLevenshtein,
    onAddChapterBefore,
    onAddChapterAfter,
  } = props;

  // Compute isSelected and isCurrentClip via context selectors
  const isSelected = useContextSelector(VideoEditorContext, (ctx) =>
    ctx.selectedClipsSet.has(clip.frontendId)
  );
  const isCurrentClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClipId === clip.frontendId
  );
  const currentTimeInClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentTimeInClip
  );
  const clipIdsBeingTranscribed = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.clipIdsBeingTranscribed
  );
  const dispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.dispatch
  );
  const onSetInsertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onSetInsertionPoint
  );
  const onMoveClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onMoveClip
  );
  const onToggleBeatForClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onToggleBeatForClip
  );
  const selectedClipsSet = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.selectedClipsSet
  );
  const onAddEffectClipAt = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddEffectClipAt
  );
  const setIsCreateVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsCreateVideoModalOpen
  );
  const onUnpinDiagram = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onUnpinDiagram
  );
  const percentComplete = getClipPercentComplete(clip, currentTimeInClip);

  const isPortrait = getIsClipPortrait(clip);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className={cn(
            "bg-card rounded-md text-left relative overflow-hidden allow-keydown flex w-full",
            isSelected && "outline-2 outline-ring bg-muted",
            isCurrentClip && "bg-blue-100 dark:bg-blue-900"
          )}
          onClick={(e) => {
            dispatch({
              type: "click-clip",
              clipId: clip.frontendId,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
            });
          }}
        >
          {/* Thumbnail image */}
          {clip.type === "on-database" ? (
            <div className="flex-shrink-0 relative">
              <img
                src={`/clips/${clip.databaseId}/first-frame`}
                alt="First frame"
                className={cn(
                  "rounded object-cover h-full object-center",
                  isPortrait ? "w-24 aspect-[9/16]" : "w-32 aspect-[16/9]",
                  clipIdsBeingTranscribed.has(clip.frontendId) &&
                    "opacity-50 grayscale"
                )}
              />
              {/* Loading spinner overlay */}
              {clipIdsBeingTranscribed.has(clip.frontendId) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-white" />
                </div>
              )}
              {/* Timecode overlay on image */}
              <div
                className={cn(
                  "absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded bg-black/60 text-white flex items-center gap-1"
                )}
              >
                {timecode}
              </div>
            </div>
          ) : clip.type === "effect-clip-optimistically-added" ? (
            <div className="flex-shrink-0 relative w-32 aspect-[16/9] bg-muted rounded flex items-center justify-center">
              <FilmIcon className="w-6 h-6 text-muted-foreground" />
            </div>
          ) : (
            <div className="flex-shrink-0 relative w-32 aspect-[16/9] bg-muted rounded flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 flex flex-col min-w-0 relative p-3">
            {/* Progress bar overlay on text */}
            {isCurrentClip && (
              <div
                className="absolute top-0 left-0 h-full bg-blue-300/50 dark:bg-blue-700 z-0 rounded"
                style={{
                  width: `${percentComplete * 100}%`,
                }}
              />
            )}

            {/* Transcript text */}
            <div className="z-10 relative text-card-foreground text-sm leading-6">
              {clipIdsBeingTranscribed.has(clip.frontendId) ? (
                clip.type === "on-database" && clip.text ? (
                  <>
                    <span className="text-muted-foreground mr-2">
                      Re-transcribing...
                    </span>
                    <span className="text-muted-foreground">{clip.text}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Transcribing...</span>
                )
              ) : clip.type === "on-database" ? (
                <>
                  {nextLevenshtein > DANGEROUS_TEXT_SIMILARITY_THRESHOLD && (
                    <span className="text-orange-500 mr-2 text-base font-semibold inline-flex items-center">
                      <AlertTriangleIcon className="w-4 h-4 mr-2" />
                      {nextLevenshtein.toFixed(0)}%
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-card-foreground",
                      isCurrentClip && "text-blue-900 dark:text-white"
                    )}
                  >
                    {clip.text}
                  </span>
                </>
              ) : clip.type === "effect-clip-optimistically-added" ? (
                <span className="text-muted-foreground italic">
                  {clip.text}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Detecting silence...
                </span>
              )}
            </div>

            {/* Diagram pin indicator */}
            {clip.type === "on-database" && clip.diagramSnapshotId && (
              <DiagramPinIndicator
                snapshotId={clip.diagramSnapshotId}
                diagramName={clip.diagramName}
              />
            )}
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            onSetInsertionPoint("before", clip.frontendId);
          }}
        >
          <ChevronLeftIcon />
          Insert Before
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            onSetInsertionPoint("after", clip.frontendId);
          }}
        >
          <ChevronRightIcon />
          Insert After
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onAddChapterBefore}>
          <PlusIcon />
          Add Chapter Before
        </ContextMenuItem>
        <ContextMenuItem onSelect={onAddChapterAfter}>
          <PlusIcon />
          Add Chapter After
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <PlusIcon />
            Add Effect Before
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              onSelect={() => {
                onAddEffectClipAt("white-noise", "before", clip.frontendId);
              }}
            >
              White Noise
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <PlusIcon />
            Add Effect After
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              onSelect={() => {
                onAddEffectClipAt("white-noise", "after", clip.frontendId);
              }}
            >
              White Noise
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={isFirstItem}
          onSelect={() => {
            onMoveClip(clip.frontendId, "up");
          }}
        >
          <ArrowUpIcon />
          Move Up
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isLastItem}
          onSelect={() => {
            onMoveClip(clip.frontendId, "down");
          }}
        >
          <ArrowDownIcon />
          Move Down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            onToggleBeatForClip(clip.frontendId);
          }}
        >
          <PauseIcon />
          {clip.beatType === "long" ? "Remove Beat" : "Add Beat"}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={clip.type !== "on-database"}
          onSelect={() => {
            dispatch({
              type: "retranscribe-clip",
              clipId: clip.frontendId,
            });
          }}
        >
          <RefreshCwIcon />
          Re-transcribe
        </ContextMenuItem>
        <ContextMenuSeparator />
        {clip.type === "on-database" && clip.diagramSnapshotId && (
          <ContextMenuItem
            onSelect={() => {
              onUnpinDiagram(clip.frontendId);
            }}
          >
            <XIcon />
            Unpin Diagram
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={async () => {
            const snapshotId =
              clip.type === "on-database" ? clip.diagramSnapshotId : null;
            let resolvedDiagramId: string | null = null;
            if (snapshotId) {
              const meta = await fetchMeta(snapshotId);
              resolvedDiagramId = meta.diagramId;
            }
            const result = resolveForClip(
              { diagramSnapshotId: snapshotId },
              () => resolvedDiagramId
            );
            if (result.kind === "diagram") {
              openPlaygroundWithDiagram(result.diagramId);
            } else {
              openPlayground();
            }
          }}
        >
          <Workflow />
          Open Diagram Playground
        </ContextMenuItem>
        {selectedClipsSet.size > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                setIsCreateVideoModalOpen(true);
              }}
            >
              <FilmIcon />
              Create New Video from Selection
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            dispatch({
              type: "delete-clip",
              clipId: clip.frontendId,
            });
          }}
        >
          <Trash2Icon />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

const DiagramPinIndicator = (props: {
  snapshotId: string;
  diagramName: string | null;
}) => {
  const { scene, diagramId, contentHash } = useDiagramSnapshotMeta(
    props.snapshotId
  );

  return (
    <div className="z-10 relative flex items-center gap-1.5 mt-1">
      {scene || (diagramId && contentHash) ? (
        <DiagramThumbnail
          diagramId={diagramId ?? undefined}
          contentHash={contentHash ?? undefined}
          scene={scene}
          className="h-6 w-9 shrink-0 overflow-hidden rounded border bg-zinc-900"
        />
      ) : (
        <ImageIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      )}
      <span className="text-xs text-muted-foreground truncate">
        {props.diagramName ?? "Diagram"}
      </span>
    </div>
  );
};
