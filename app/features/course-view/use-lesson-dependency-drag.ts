import { useDependencyDragOptional } from "./dependency-drag-context";

export function useLessonDependencyDrag(lessonId: string) {
  const depDrag = useDependencyDragOptional();
  const isDragSource = depDrag?.dragState?.sourceId === lessonId;
  const isDragTarget =
    depDrag?.hoveredTargetId === lessonId && !!depDrag?.dragState;
  const dropAction = isDragTarget
    ? depDrag?.getDropResult(lessonId)?.action
    : null;

  let dragClassName = "";
  if (isDragSource) {
    dragClassName = "opacity-60";
  } else if (isDragTarget) {
    if (dropAction === "add")
      dragClassName = "ring-2 ring-green-500/50 bg-green-500/5";
    else if (dropAction === "remove")
      dragClassName = "ring-2 ring-amber-500/50 bg-amber-500/5";
    else if (dropAction === "noop")
      dragClassName = "ring-2 ring-red-500/50 bg-red-500/5";
  }

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
