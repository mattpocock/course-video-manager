import { deepLinkAnchor } from "@/features/entity-links/use-deep-link-focus";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { timelineItemMenuGroups } from "./timeline-item-menu";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  AudioWaveformIcon,
  FilmIcon,
  ImageIcon,
  LayersIcon,
  Link2Icon,
  Loader2,
  MicIcon,
  PauseIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
  ZoomInIcon,
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
import { useDiagramSnapshotMeta } from "@/features/diagrams/use-diagram-snapshot-scene";
import { getWebLinkLabel } from "@/lib/clip-web-link";
import { canZoomClip } from "@/features/videos/clip-zoom";
import { effectiveClipScene } from "@cvm/core/features/videos/effective-scene";
import { clipScenePicker } from "./clip-scene-picker";
import { clipEditTranscriptAction } from "./clip-edit-transcript-action";
import { openDiagramPlaygroundForClip } from "./open-diagram-playground-for-clip";
import { clipStillUrl } from "../clip-still-url";
import { holdsStillsOf, stillRound } from "../cvm-recorder-reducer";
import { HeldStill } from "./held-still";
import { isTranscriptionPending } from "@/features/videos/transcription-status";
import {
  overlayKindLabel,
  resolveOverlayKind,
} from "@/features/videos/overlay-kind";

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
  const dispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.dispatch
  );
  const onRemoveWebLink = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onRemoveWebLink
  );
  // Every Overlay that COVERS this Clip, anchored to it or spilling onto it
  // from an earlier one — the same grouping the player preview draws from, so
  // a Clip carries a badge exactly when a card is on screen over it.
  const coveringOverlays = useContextSelector(VideoEditorContext, (ctx) =>
    clip.type === "on-database"
      ? ctx.overlaysByClipId.get(clip.databaseId)
      : undefined
  );
  const stillHeld = useContextSelector(
    VideoEditorContext,
    (ctx) =>
      clip.type === "on-database" && holdsStillsOf(ctx.cvmRecorder.state, clip)
  );
  const round = useContextSelector(VideoEditorContext, (ctx) =>
    stillRound(ctx.cvmRecorder.state)
  );
  const percentComplete = getClipPercentComplete(clip, currentTimeInClip);
  const transcriptionStatus =
    clip.type === "on-database" ? clip.transcriptionStatus : null;
  const isBeingTranscribed =
    transcriptionStatus !== null && isTranscriptionPending(transcriptionStatus);
  const retry = () =>
    dispatch({ type: "retranscribe-clip", clipId: clip.frontendId });

  const isPortrait = getIsClipPortrait(clip);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          {...(clip.type === "on-database" && deepLinkAnchor(clip.databaseId))}
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
          {clip.type === "on-database" && stillHeld ? (
            <HeldStill isPortrait={isPortrait} timecode={timecode} />
          ) : clip.type === "on-database" ? (
            <div className="flex-shrink-0 relative">
              <img
                key={round}
                src={clipStillUrl(clip, "first")}
                alt="First frame"
                className={cn(
                  "rounded object-cover h-full object-center",
                  isPortrait ? "w-24 aspect-[9/16]" : "w-32 aspect-[16/9]",
                  isBeingTranscribed && "opacity-50 grayscale"
                )}
              />
              {/* Loading spinner overlay */}
              {isBeingTranscribed && (
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
              {transcriptionStatus === "failed" ? (
                <>
                  <span className="text-red-500 mr-2 font-semibold inline-flex items-center">
                    <AlertTriangleIcon className="w-4 h-4 mr-2" />
                    Transcription failed
                  </span>
                  {/* A span, not a <button>: the whole Clip row is already a
                      button, and a nested <button> is invalid HTML that the
                      server-rendered markup splits out of the row. */}
                  <span
                    role="button"
                    tabIndex={0}
                    className="mr-2 inline-block rounded border border-red-500/50 px-1.5 text-xs text-red-500 hover:bg-red-500/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      retry();
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      retry();
                    }}
                  >
                    Retry
                  </span>
                  {clip.type === "on-database" && clip.text && (
                    <span className="text-muted-foreground">{clip.text}</span>
                  )}
                </>
              ) : isBeingTranscribed ? (
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

            {/* Clip Zoom badge — only ever present on a camera scene */}
            {clip.type === "on-database" && clip.zoomType !== "none" && (
              <div className="z-10 relative mt-2 flex">
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  <ZoomInIcon className="w-3 h-3 shrink-0" />
                  Zoomed
                </span>
              </div>
            )}

            {/* Overlays covering this Clip. Each badge names its own Overlay
                Kind, read off the row through `overlayKindLabel` — an Overlay
                written before the `kind` column existed reads as a Definition
                Card, exactly as it renders. An Overlay anchored to an earlier
                Clip is listed too, because it is still on screen here — `at`
                is negative for those. */}
            {coveringOverlays && coveringOverlays.length > 0 && (
              <div className="z-10 relative mt-2 flex flex-wrap gap-1">
                {coveringOverlays.map((overlay) => {
                  const kindLabel = overlayKindLabel(overlay.kind);
                  // A Bullet Panel also moves the camera under it, so its
                  // badge carries the zoom mark the Clip Zoom badge uses —
                  // the two are the same kind of thing to the eye, and never
                  // both on one Clip.
                  const OverlayIcon =
                    resolveOverlayKind(overlay.kind) === "bulletPanel"
                      ? ZoomInIcon
                      : LayersIcon;
                  return (
                    <span
                      key={overlay.id}
                      title={
                        overlay.at < 0
                          ? `${kindLabel}, continuing from an earlier Clip: ${overlay.title}`
                          : `${kindLabel}, ${overlay.at}s into this Clip for ${overlay.durationInSeconds}s: ${overlay.title}`
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground max-w-[16rem]",
                        // Dimmed where the Overlay only carries over from an
                        // earlier Clip, so the Clip that OWNS it still reads
                        // as the one to edit.
                        overlay.at < 0 && "opacity-60"
                      )}
                    >
                      <OverlayIcon className="w-3 h-3 shrink-0" />
                      <span className="truncate">
                        {kindLabel} · {overlay.title}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Diagram pin indicator */}
            {clip.type === "on-database" && clip.diagramSnapshotId && (
              <DiagramPinIndicator
                snapshotId={clip.diagramSnapshotId}
                diagramName={clip.diagramName}
                clipFrontendId={clip.frontendId}
                clipDatabaseId={clip.databaseId}
              />
            )}

            {/* On-screen web links captured during recording */}
            {clip.type === "on-database" && clip.webLinks.length > 0 && (
              <div className="z-10 relative mt-2 flex flex-wrap gap-1">
                {clip.webLinks.map((link) => (
                  <span
                    key={link.id}
                    className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground max-w-[16rem]"
                  >
                    <Link2Icon className="w-3 h-3 shrink-0" />
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      title={link.title || link.url}
                      className="truncate hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {getWebLinkLabel(link.url)}
                    </a>
                    <button
                      type="button"
                      aria-label="Remove link"
                      className="shrink-0 rounded hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveWebLink(clip.frontendId, link.id);
                      }}
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </button>
      </ContextMenuTrigger>
      <ClipMenuContent
        clip={clip}
        isFirstItem={isFirstItem}
        isLastItem={isLastItem}
        onAddChapterBefore={onAddChapterBefore}
        onAddChapterAfter={onAddChapterAfter}
      />
    </ContextMenu>
  );
};

/**
 * A Clip's right-click menu. Mounted only while open, so the editor state it
 * reads does not re-render every Clip in the timeline.
 */
const ClipMenuContent = (props: {
  clip: Clip;
  isFirstItem: boolean;
  isLastItem: boolean;
  onAddChapterBefore: () => void;
  onAddChapterAfter: () => void;
}) => {
  const { clip } = props;
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const dispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.dispatch
  );
  const isBeingTranscribed =
    clip.type === "on-database" &&
    isTranscriptionPending(clip.transcriptionStatus);
  const hasSelection = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.selectedClipsSet.size > 0
  );
  const onSetInsertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onSetInsertionPoint
  );
  const onMoveClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onMoveClip
  );
  const onTogglePauseForClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onTogglePauseForClip
  );
  const onToggleZoomForClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onToggleZoomForClip
  );
  const onSetSceneOverride = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.onSetSceneOverride
  );
  const onAddEffectClipAt = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddEffectClipAt
  );
  const modalDispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.modalDispatch
  );
  const onDatabase = clip.type === "on-database" ? clip : null;
  const shared = timelineItemMenuGroups({
    onInsert: (position) => onSetInsertionPoint(position, clip.frontendId),
    onAddChapter: (position) =>
      position === "before"
        ? props.onAddChapterBefore()
        : props.onAddChapterAfter(),
    onCreateVideoFromSelection: hasSelection
      ? () => modalDispatch({ type: "create-video-from-selection-clicked" })
      : undefined,
    move: {
      onMove: (direction) => onMoveClip(clip.frontendId, direction),
      isFirstItem: props.isFirstItem,
      isLastItem: props.isLastItem,
    },
    delete: {
      confirms: false,
      shortcut: "Del",
      onSelect: () =>
        dispatch({ type: "delete-clip", clipId: clip.frontendId }),
    },
  });

  return (
    <EntityMenuContent
      menu="context"
      entity={
        onDatabase && { type: "clip", id: onDatabase.databaseId, videoId }
      }
      groups={{
        // Opening and unpinning a pinned Diagram live on the Clip's pin
        // badge, and Open Diagram Playground on the Video's Actions menu
        // (rule 9: keep the menu near a dozen items).
        edit: [
          clipEditTranscriptAction(clip, () =>
            modalDispatch({
              type: "edit-transcript-clicked",
              clipId: clip.frontendId,
            })
          ),
          {
            label: clip.pauseType === "long" ? "Remove Pause" : "Add Pause",
            icon: PauseIcon,
            shortcut: "B",
            onSelect: () => onTogglePauseForClip(clip.frontendId),
          },
          // Only on a scene that can zoom: roughly nine Clips in ten are a
          // Code scene, and a greyed-out entry on each would be noise. Until
          // the Clip is saved it applies but cannot run yet.
          clipScenePicker(clip, onSetSceneOverride),
          // A CVM-recorder Clip's mic is its own file: its Recording
          // Session's offset and the shared EQ are applied at export.
          !!onDatabase?.recordingSession && {
            label: "Mic Settings",
            icon: MicIcon,
            opensDialog: true,
            onSelect: () =>
              modalDispatch({
                type: "mic-settings-clicked",
                clipId: clip.frontendId,
              }),
          },
          canZoomClip(effectiveClipScene(clip)) && {
            label:
              onDatabase && onDatabase.zoomType !== "none"
                ? "Remove Zoom"
                : "Add Zoom",
            icon: ZoomInIcon,
            disabled: !onDatabase,
            onSelect: () => onToggleZoomForClip(clip.frontendId),
          },
        ],
        create: [
          ...shared.create,
          {
            label: "Add Effect",
            icon: PlusIcon,
            items: (["before", "after"] as const).map((position) => ({
              label: `White Noise ${position === "before" ? "Before" : "After"}`,
              icon: AudioWaveformIcon,
              onSelect: () =>
                onAddEffectClipAt("white-noise", position, clip.frontendId),
            })),
          },
        ],
        move: shared.move,
        run: [
          {
            label: "Re-transcribe",
            icon: RefreshCwIcon,
            // Applies to every Clip, but only a saved one that is not already
            // being transcribed can run it.
            disabled: !onDatabase || isBeingTranscribed,
            onSelect: () =>
              dispatch({ type: "retranscribe-clip", clipId: clip.frontendId }),
          },
        ],
        danger: shared.danger,
      }}
    />
  );
};

/**
 * The Clip's pinned Diagram. Click it to open the Diagram Playground on it;
 * the x unpins it. Both moved here from the Clip's menu (rule 9).
 */
const DiagramPinIndicator = (props: {
  snapshotId: string;
  diagramName: string | null;
  clipFrontendId: Clip["frontendId"];
  clipDatabaseId: Extract<Clip, { type: "on-database" }>["databaseId"];
}) => {
  const { scene, diagramId, contentHash } = useDiagramSnapshotMeta(
    props.snapshotId
  );
  const onUpdateClipDiagramPin = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onUpdateClipDiagramPin
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
      <button
        type="button"
        title="Open in Diagram Playground"
        className="text-xs text-muted-foreground truncate hover:text-foreground hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          void openDiagramPlaygroundForClip(props.snapshotId);
        }}
      >
        {props.diagramName ?? "Diagram"}
      </button>
      <button
        type="button"
        aria-label="Unpin Diagram"
        title="Unpin Diagram"
        className="shrink-0 rounded text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onUpdateClipDiagramPin(
            props.clipFrontendId,
            props.clipDatabaseId,
            null,
            null
          );
        }}
      >
        <XIcon className="w-3 h-3" />
      </button>
    </div>
  );
};
