import { cn } from "@/lib/utils";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import {
  CLIP_MOCKUP_CONTAINER_ID,
  computeClipMockupDrop,
  type ClipMockupDrop,
} from "./clip-mockup-dnd";

/**
 * The dnd-kit half of Clip Mockup reordering — a thinner sibling of
 * `beat-dnd-context.tsx`. One list, one container, no cross-Video drop
 * preview: a Clip Mockup cannot leave its Video, so dnd-kit's own sortable
 * shifting is the only preview there is to draw.
 *
 * All the arithmetic lives in {@link computeClipMockupDrop}; this file is
 * wiring.
 */
export function ClipMockupDndProvider({
  clipMockupIds,
  onMove,
  children,
}: {
  clipMockupIds: string[];
  onMove: (drop: ClipMockupDrop) => void;
  children: ReactNode;
}) {
  // A small distance constraint so clicking a line to edit it still fires.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const drop = computeClipMockupDrop({
      activeId: String(event.active.id),
      overId: event.over ? String(event.over.id) : null,
      clipMockupIds,
    });
    if (drop) onMove(drop);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {children}
    </DndContext>
  );
}

/**
 * The Animatic as a droppable, vertically-sortable list. The container itself
 * is a drop target so the end of the list stays reachable.
 */
export function ClipMockupSortableList({
  clipMockupIds,
  className,
  children,
}: {
  clipMockupIds: string[];
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: CLIP_MOCKUP_CONTAINER_ID });

  return (
    <SortableContext
      items={clipMockupIds}
      strategy={verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={cn(className, isOver && "bg-primary/5 rounded")}
      >
        {children}
      </div>
    </SortableContext>
  );
}

/** A draggable Clip Mockup row with a grip handle; `children` is the row content. */
export function SortableClipMockup({
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
  } = useSortable({ id, data: { type: "clip-mockup" } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-1">
      <button
        ref={setActivatorNodeRef}
        className="mt-1 cursor-grab active:cursor-grabbing touch-none text-muted-foreground/40 hover:text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
