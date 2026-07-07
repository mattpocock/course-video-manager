import { cn } from "@/lib/utils";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import {
  computeBeatDrop,
  beatContainerId,
  type BeatDndVideo,
  type BeatDrop,
} from "./beat-dnd";

/**
 * The live drop target during a Beat drag, broadcast so each Video's list
 * can draw an insertion line at the landing spot. `null` when nothing is being
 * dragged, or for a same-Video reorder (dnd-kit's sortable already shifts the
 * siblings to preview that, so a line would double up).
 */
type BeatDropPreview = {
  targetVideoId: string;
  beforeBeatId: string | null;
} | null;

const BeatDropContext = createContext<BeatDropPreview>(null);

function samePreview(a: BeatDropPreview, b: BeatDropPreview): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.targetVideoId === b.targetVideoId && a.beforeBeatId === b.beforeBeatId
  );
}

/** The current cross-Video drop preview, or `null`. Safe to call with no provider. */
export function useBeatDropPreview(): BeatDropPreview {
  return useContext(BeatDropContext);
}

/** Insertion indicator showing where a dragged Beat will land. */
export function BeatDropLine() {
  return <div className="h-0.5 my-0.5 rounded-full bg-primary" />;
}

/**
 * One DndContext spanning a set of Videos, so Beats can be dragged to
 * reorder within a Video or moved into a sibling Video. Resolves each drop to a
 * {@link BeatDrop} and hands it to `onMove`.
 */
export function BeatDndProvider({
  videos,
  onMove,
  children,
}: {
  videos: BeatDndVideo[];
  onMove: (drop: BeatDrop) => void;
  children: ReactNode;
}) {
  // A small distance constraint so clicking the title/handle still fires clicks.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const [preview, setPreview] = useState<BeatDropPreview>(null);

  const videoIdOfBeat = (beatId: string) =>
    videos.find((v) => v.beats.some((s) => s.id === beatId))?.id ?? null;

  const handleDragOver = (event: DragOverEvent) => {
    const activeId = String(event.active.id);
    const drop = computeBeatDrop({
      activeId,
      overId: event.over ? String(event.over.id) : null,
      videos,
    });
    // Only preview cross-Video moves; within a Video the sortable already shifts
    // its siblings to show the gap.
    const next: BeatDropPreview =
      drop && drop.targetVideoId !== videoIdOfBeat(activeId)
        ? {
            targetVideoId: drop.targetVideoId,
            beforeBeatId: drop.beforeBeatId,
          }
        : null;
    // onDragOver fires on every pointer move, but the landing spot rarely
    // changes. Keep the previous reference when it hasn't, so React bails out
    // instead of re-rendering every Video's beat list on each move.
    setPreview((prev) => (samePreview(prev, next) ? prev : next));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setPreview(null);
    const drop = computeBeatDrop({
      activeId: String(event.active.id),
      overId: event.over ? String(event.over.id) : null,
      videos,
    });
    if (drop) onMove(drop);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setPreview(null)}
    >
      <BeatDropContext.Provider value={preview}>
        {children}
      </BeatDropContext.Provider>
    </DndContext>
  );
}

/**
 * A Video's Beat list: a droppable container (so an empty Video and the
 * end-of-list are valid drop targets) wrapping a vertical SortableContext.
 */
export function BeatSortableList({
  videoId,
  beatIds,
  className,
  children,
}: {
  videoId: string;
  beatIds: string[];
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: beatContainerId(videoId),
  });

  return (
    <SortableContext items={beatIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cn(className, isOver && "bg-primary/5 rounded")}
      >
        {children}
      </div>
    </SortableContext>
  );
}

/** A draggable Beat row with a grip handle; `children` is the row content. */
export function SortableBeat({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { type: "beat" } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      <button
        ref={setActivatorNodeRef}
        className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground/40 hover:text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
