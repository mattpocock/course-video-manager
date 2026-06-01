import { useDependencyDragOptional } from "./dependency-drag-context";

export function useLessonDependencyDrag(lessonId: string) {
  const depDrag = useDependencyDragOptional();
  const isDragSource = depDrag?.dragState?.sourceId === lessonId;
  const isDragTarget =
    depDrag?.hoveredTargetId === lessonId && !!depDrag?.dragState;
  const dropAction = isDragTarget
    ? depDrag?.getDropResult(lessonId)?.action
    : null;

  const dragClassName = isDragSource
    ? "opacity-60"
    : isDragTarget
      ? dropAction === "add"
        ? "ring-2 ring-green-500/50 bg-green-500/5"
        : dropAction === "remove"
          ? "ring-2 ring-amber-500/50 bg-amber-500/5"
          : dropAction === "noop"
            ? "ring-2 ring-red-500/50 bg-red-500/5"
            : ""
      : "";

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
