import { useDependencyDragOptional } from "./dependency-drag-context";
import type { DropResult } from "./dependency-drag";

export interface DragClassNameInput {
  isDragSource: boolean;
  isDragTarget: boolean;
  isExistingDependency: boolean;
  dropAction: DropResult["action"] | null;
}

export function computeDragClassName(input: DragClassNameInput): string {
  if (input.isDragSource) {
    return "opacity-60";
  }
  if (input.isDragTarget) {
    if (input.dropAction === "add")
      return "ring-2 ring-green-500/50 bg-green-500/5";
    if (input.dropAction === "remove")
      return "ring-2 ring-amber-500/50 bg-amber-500/5";
    if (input.dropAction === "noop")
      return "ring-2 ring-red-500/50 bg-red-500/5";
  }
  if (input.isExistingDependency) {
    return "ring-2 ring-slate-400/50 bg-slate-400/5";
  }
  return "";
}

export function useLessonDependencyDrag(lessonId: string) {
  const depDrag = useDependencyDragOptional();
  const isDragSource = depDrag?.dragState?.sourceId === lessonId;
  const isDragTarget =
    depDrag?.hoveredTargetId === lessonId && !!depDrag?.dragState;
  const dropAction = isDragTarget
    ? (depDrag?.getDropResult(lessonId)?.action ?? null)
    : null;
  const isExistingDependency =
    !!depDrag?.dragState &&
    !isDragSource &&
    (depDrag.dragState.sourceDeps?.includes(lessonId) ?? false);

  const dragClassName = computeDragClassName({
    isDragSource,
    isDragTarget,
    isExistingDependency,
    dropAction,
  });

  return {
    dragClassName,
    dragTargetHandlers: {
      onPointerEnter: () => {
        if (depDrag?.dragState && depDrag.dragState.sourceId !== lessonId) {
          depDrag.setHoveredTarget(lessonId);
        }
      },
      onPointerLeave: () => {
        if (depDrag?.hoveredTargetId === lessonId) {
          depDrag.setHoveredTarget(null);
        }
      },
    },
  };
}
