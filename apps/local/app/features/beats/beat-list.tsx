import { Checkbox } from "@/components/ui/checkbox";
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
import { useLocalStorageBoolean } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { Plus } from "lucide-react";
import { Fragment } from "react";
import { useRequestCreateBeat } from "./create-beat-dialog";
import {
  BeatDropLine,
  BeatSortableList,
  SortableBeat,
  useBeatDropPreview,
} from "./beat-dnd-context";
import {
  BEAT_KINDS,
  BEAT_KIND_ICONS,
  BEAT_KIND_LABELS,
  type BeatKind,
} from "./beat-kinds";
import { BeatContextMenuContent } from "./beat-menu-items";
import { BeatDescriptionEditor } from "./beat-description-editor";
import { useShowBeatDescriptions } from "./beat-descriptions-context";
import { BeatTitleEditor } from "./beat-title-editor";

/**
 * The shape every surface's Beat rows agree on. A loosened `kind: string`
 * (rather than `BeatKind`) so loader rows decode cleanly; it's narrowed at
 * the icon/label lookup.
 */
export type BeatListBeat = {
  id: string;
  videoId: string;
  kind: string;
  title: string;
  /** In-app planning note. Surfaced only where `showDescriptions` is set. */
  description: string;
  order: string;
};

/**
 * The canonical, ordered Beat plan for a single Video — shared by the pitch
 * view, the compact course view, and the video editor's Beat Panel.
 *
 * `isReadOnly` toggles the two modes:
 *  - **Editable**: draggable rows (within and across Videos, via the
 *    surrounding {@link BeatDndProvider}), an inline-rename title, a
 *    per-Beat context menu (set-kind / add-before / add-after / delete), and
 *    an always-visible "Add beat" dropdown offering the five kinds.
 *  - **Read-only**: plain rows (kind icon + title, placeholder = kind label) —
 *    no handles, menus, or add button. Used while a capture is in progress.
 *
 * Mounting the DnD and create-Beat dialog providers is the caller's job, so
 * one surface can span several Videos (pitch/compact) or just one (editor).
 */
export function BeatList({
  video,
  submitEvent,
  isReadOnly,
  showDescriptions,
  courseId,
  sectionId,
  className,
}: {
  video: { id: string; beats: BeatListBeat[] };
  submitEvent: (event: CourseEditorEvent) => void;
  isReadOnly: boolean;
  /**
   * Show the inline Beat Description note under each row. The editor's
   * Beats tab sets it directly; the Section Workbench turns it on for its
   * whole subtree via {@link BeatDescriptionsProvider}. Defaults to the
   * ambient context (off on the dense course view, which hides the note).
   */
  showDescriptions?: boolean;
  courseId?: string;
  sectionId?: string;
  className?: string;
}) {
  const ambientShowDescriptions = useShowBeatDescriptions();
  const showDescription = showDescriptions ?? ambientShowDescriptions;
  const beats = video.beats;
  const dropPreview = useBeatDropPreview();
  const previewInThisVideo =
    dropPreview?.targetVideoId === video.id ? dropPreview : null;

  if (isReadOnly) {
    return (
      <div className={cn("space-y-0.5", className)}>
        {beats.map((beat) => (
          <BeatRow
            key={beat.id}
            beat={beat}
            nextBeatId={null}
            isReadOnly
            showDescription={showDescription}
            submitEvent={submitEvent}
            courseId={courseId}
            sectionId={sectionId}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <BeatSortableList
        videoId={video.id}
        beatIds={beats.map((s) => s.id)}
        className="space-y-0.5 min-h-[0.5rem]"
      >
        {beats.map((beat, index) => (
          <Fragment key={beat.id}>
            {previewInThisVideo?.beforeBeatId === beat.id && <BeatDropLine />}
            <SortableBeat id={beat.id}>
              <BeatRow
                beat={beat}
                nextBeatId={beats[index + 1]?.id ?? null}
                isReadOnly={false}
                showDescription={showDescription}
                submitEvent={submitEvent}
                courseId={courseId}
                sectionId={sectionId}
              />
            </SortableBeat>
          </Fragment>
        ))}
        {previewInThisVideo?.beforeBeatId === null && <BeatDropLine />}
      </BeatSortableList>

      <AddBeatButton videoId={video.id} />
    </div>
  );
}

/** Always-visible "Add beat ▸ <kind>" dropdown that appends to the Video. */
function AddBeatButton({ videoId }: { videoId: string }) {
  const requestCreateBeat = useRequestCreateBeat();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
          <Plus className="w-3 h-3" />
          Add beat
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {BEAT_KINDS.map((kind) => {
          const Icon = BEAT_KIND_ICONS[kind];
          return (
            <DropdownMenuItem
              key={kind}
              onSelect={() =>
                requestCreateBeat({ videoId, kind, beforeBeatId: null })
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

function BeatRow({
  beat,
  nextBeatId,
  isReadOnly,
  showDescription,
  submitEvent,
  courseId,
  sectionId,
}: {
  beat: BeatListBeat;
  nextBeatId: string | null;
  isReadOnly: boolean;
  showDescription: boolean;
  submitEvent: (event: CourseEditorEvent) => void;
  courseId?: string;
  sectionId?: string;
}) {
  const kind = beat.kind as BeatKind;
  const Icon = BEAT_KIND_ICONS[kind];
  const requestCreateBeat = useRequestCreateBeat();
  const [completed, setCompleted] = useLocalStorageBoolean(
    `beat-completion:${beat.id}`
  );

  const titleRow = (
    <div className="flex items-center gap-1.5 text-sm text-foreground/80 cursor-context-menu">
      <Checkbox
        checked={completed}
        onCheckedChange={(checked) => setCompleted(checked === true)}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      />
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
      <BeatTitleEditor
        title={beat.title}
        placeholder={BEAT_KIND_LABELS[kind]}
        isReadOnly={isReadOnly}
        onSave={(title) =>
          submitEvent({ type: "rename-beat", beatId: beat.id, title })
        }
      />
    </div>
  );

  // The free-text planning note, aligned under the title (clearing the icon).
  const description = showDescription ? (
    <BeatDescriptionEditor
      description={beat.description}
      isReadOnly={isReadOnly}
      onSave={(description) =>
        submitEvent({
          type: "update-beat-description",
          beatId: beat.id,
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
          <BeatContextMenuContent
            onSetKind={(nextKind) =>
              submitEvent({
                type: "set-beat-kind",
                beatId: beat.id,
                kind: nextKind,
              })
            }
            onAddBefore={(kind) =>
              requestCreateBeat({
                videoId: beat.videoId,
                kind,
                beforeBeatId: beat.id,
              })
            }
            onAddAfter={(kind) =>
              requestCreateBeat({
                videoId: beat.videoId,
                kind,
                beforeBeatId: nextBeatId,
              })
            }
            onDelete={() =>
              submitEvent({ type: "delete-beat", beatId: beat.id })
            }
            courseId={courseId}
            sectionId={sectionId}
            videoId={beat.videoId}
            beatId={beat.id}
          />
        </ContextMenuContent>
      </ContextMenu>
      {description}
    </div>
  );
}
