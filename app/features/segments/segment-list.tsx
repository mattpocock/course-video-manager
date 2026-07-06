import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { Plus } from "lucide-react";
import { Fragment } from "react";
import { useRequestCreateSegment } from "./create-segment-dialog";
import {
  SegmentDropLine,
  SegmentSortableList,
  SortableSegment,
  useSegmentDropPreview,
} from "./segment-dnd-context";
import {
  BEAT_KINDS,
  BEAT_KIND_ICONS,
  BEAT_KIND_LABELS,
  type BeatKind,
} from "./segment-kinds";
import { SegmentContextMenuContent } from "./segment-menu-items";
import { BeatDescriptionEditor } from "./segment-description-editor";
import { useShowBeatDescriptions } from "./segment-descriptions-context";
import { SegmentTitleEditor } from "./segment-title-editor";

/**
 * The shape every surface's Segment rows agree on. A loosened `kind: string`
 * (rather than `BeatKind`) so loader rows decode cleanly; it's narrowed at
 * the icon/label lookup.
 */
export type SegmentListSegment = {
  id: string;
  videoId: string;
  kind: string;
  title: string;
  /** In-app planning note. Surfaced only where `showDescriptions` is set. */
  description: string;
  order: string;
};

/**
 * The canonical, ordered Segment plan for a single Video — shared by the pitch
 * view, the compact course view, and the video editor's Segment Panel.
 *
 * `isReadOnly` toggles the two modes:
 *  - **Editable**: draggable rows (within and across Videos, via the
 *    surrounding {@link SegmentDndProvider}), an inline-rename title, a
 *    per-Segment context menu (set-kind / add-before / add-after / delete), and
 *    an always-visible "Add segment" dropdown offering the five kinds.
 *  - **Read-only**: plain rows (kind icon + title, placeholder = kind label) —
 *    no handles, menus, or add button. Used while a capture is in progress.
 *
 * Mounting the DnD and create-Segment dialog providers is the caller's job, so
 * one surface can span several Videos (pitch/compact) or just one (editor).
 */
export function SegmentList({
  video,
  submitEvent,
  isReadOnly,
  showDescriptions,
  className,
}: {
  video: { id: string; segments: SegmentListSegment[] };
  submitEvent: (event: CourseEditorEvent) => void;
  isReadOnly: boolean;
  /**
   * Show the inline Beat Description note under each row. The editor's
   * Segments tab sets it directly; the Section Workbench turns it on for its
   * whole subtree via {@link BeatDescriptionsProvider}. Defaults to the
   * ambient context (off on the dense course view, which hides the note).
   */
  showDescriptions?: boolean;
  className?: string;
}) {
  const ambientShowDescriptions = useShowBeatDescriptions();
  const showDescription = showDescriptions ?? ambientShowDescriptions;
  const segments = video.segments;
  const dropPreview = useSegmentDropPreview();
  const previewInThisVideo =
    dropPreview?.targetVideoId === video.id ? dropPreview : null;

  if (isReadOnly) {
    return (
      <div className={cn("space-y-0.5", className)}>
        {segments.map((segment) => (
          <SegmentRow
            key={segment.id}
            segment={segment}
            nextSegmentId={null}
            isReadOnly
            showDescription={showDescription}
            submitEvent={submitEvent}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <SegmentSortableList
        videoId={video.id}
        segmentIds={segments.map((s) => s.id)}
        className="space-y-0.5 min-h-[0.5rem]"
      >
        {segments.map((segment, index) => (
          <Fragment key={segment.id}>
            {previewInThisVideo?.beforeSegmentId === segment.id && (
              <SegmentDropLine />
            )}
            <SortableSegment id={segment.id}>
              <SegmentRow
                segment={segment}
                nextSegmentId={segments[index + 1]?.id ?? null}
                isReadOnly={false}
                showDescription={showDescription}
                submitEvent={submitEvent}
              />
            </SortableSegment>
          </Fragment>
        ))}
        {previewInThisVideo?.beforeSegmentId === null && <SegmentDropLine />}
      </SegmentSortableList>

      <AddSegmentButton videoId={video.id} />
    </div>
  );
}

/** Always-visible "Add segment ▸ <kind>" dropdown that appends to the Video. */
function AddSegmentButton({ videoId }: { videoId: string }) {
  const requestCreateSegment = useRequestCreateSegment();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
          <Plus className="w-3 h-3" />
          Add segment
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {BEAT_KINDS.map((kind) => {
          const Icon = BEAT_KIND_ICONS[kind];
          return (
            <DropdownMenuItem
              key={kind}
              onSelect={() =>
                requestCreateSegment({ videoId, kind, beforeSegmentId: null })
              }
            >
              <Icon className="w-4 h-4" />
              {BEAT_KIND_LABELS[kind]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SegmentRow({
  segment,
  nextSegmentId,
  isReadOnly,
  showDescription,
  submitEvent,
}: {
  segment: SegmentListSegment;
  nextSegmentId: string | null;
  isReadOnly: boolean;
  showDescription: boolean;
  submitEvent: (event: CourseEditorEvent) => void;
}) {
  const kind = segment.kind as BeatKind;
  const Icon = BEAT_KIND_ICONS[kind];
  const requestCreateSegment = useRequestCreateSegment();

  const titleRow = (
    <div className="flex items-center gap-1.5 text-sm text-foreground/80 cursor-context-menu">
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
      <SegmentTitleEditor
        title={segment.title}
        placeholder={BEAT_KIND_LABELS[kind]}
        isReadOnly={isReadOnly}
        onSave={(title) =>
          submitEvent({ type: "rename-segment", segmentId: segment.id, title })
        }
      />
    </div>
  );

  // The free-text planning note, aligned under the title (clearing the icon).
  const description = showDescription ? (
    <BeatDescriptionEditor
      description={segment.description}
      isReadOnly={isReadOnly}
      onSave={(description) =>
        submitEvent({
          type: "update-segment-description",
          segmentId: segment.id,
          description,
        })
      }
      className="ml-5 mt-0.5"
    />
  ) : null;

  if (isReadOnly) {
    return (
      <div>
        {titleRow}
        {description}
      </div>
    );
  }

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>{titleRow}</ContextMenuTrigger>
        <ContextMenuContent>
          <SegmentContextMenuContent
            onSetKind={(nextKind) =>
              submitEvent({
                type: "set-segment-kind",
                segmentId: segment.id,
                kind: nextKind,
              })
            }
            onAddBefore={(kind) =>
              requestCreateSegment({
                videoId: segment.videoId,
                kind,
                beforeSegmentId: segment.id,
              })
            }
            onAddAfter={(kind) =>
              requestCreateSegment({
                videoId: segment.videoId,
                kind,
                beforeSegmentId: nextSegmentId,
              })
            }
            onDelete={() =>
              submitEvent({ type: "delete-segment", segmentId: segment.id })
            }
          />
        </ContextMenuContent>
      </ContextMenu>
      {description}
    </div>
  );
}
