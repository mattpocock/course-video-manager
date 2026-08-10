import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SortableSectionItem({
  id,
  compact,
  children,
}: {
  id: string;
  compact?: boolean;
  children: (
    dragHandleListeners: ReturnType<typeof useSortable>["listeners"]
  ) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { type: "section" } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(!compact && "rounded-lg border bg-card")}
    >
      {children(listeners)}
    </div>
  );
}
