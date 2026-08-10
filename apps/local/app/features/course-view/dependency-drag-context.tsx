import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { computeDropResult, type DropResult } from "./dependency-drag";

interface DragState {
  sourceId: string;
  sourceDeps: string[];
  sourceElement: HTMLElement;
}

interface DependencyDragContextValue {
  dragState: DragState | null;
  hoveredTargetId: string | null;
  startDrag: (
    sourceId: string,
    sourceDeps: string[],
    sourceElement: HTMLElement
  ) => void;
  setHoveredTarget: (targetId: string | null) => void;
  getDropResult: (targetId: string) => DropResult | null;
}

const DependencyDragContext = createContext<DependencyDragContextValue | null>(
  null
);

export function useDependencyDragOptional() {
  return useContext(DependencyDragContext);
}

export function DependencyDragProvider({
  children,
  dependencyMap,
  onDrop,
  isReadOnly,
}: {
  children: ReactNode;
  dependencyMap: Record<string, string[]>;
  onDrop: (sourceId: string, newDeps: string[]) => void;
  isReadOnly: boolean;
}) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(
    null
  );

  const hoveredTargetIdRef = useRef<string | null>(null);
  const dependencyMapRef = useRef(dependencyMap);
  const onDropRef = useRef(onDrop);
  dependencyMapRef.current = dependencyMap;
  onDropRef.current = onDrop;

  const startDrag = useCallback(
    (sourceId: string, sourceDeps: string[], sourceElement: HTMLElement) => {
      if (isReadOnly) return;
      setDragState({ sourceId, sourceDeps, sourceElement });
    },
    [isReadOnly]
  );

  const setHoveredTarget = useCallback((targetId: string | null) => {
    hoveredTargetIdRef.current = targetId;
    setHoveredTargetId(targetId);
  }, []);

  const getDropResult = useCallback(
    (targetId: string): DropResult | null => {
      if (!dragState) return null;
      return computeDropResult(
        dragState.sourceId,
        targetId,
        dragState.sourceDeps,
        dependencyMapRef.current
      );
    },
    [dragState]
  );

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e: PointerEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    const handlePointerUp = () => {
      const targetId = hoveredTargetIdRef.current;
      if (targetId) {
        const result = computeDropResult(
          dragState.sourceId,
          targetId,
          dragState.sourceDeps,
          dependencyMapRef.current
        );
        if (result.action !== "noop") {
          onDropRef.current(dragState.sourceId, result.dependencies);
        }
      }
      cleanup();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanup();
      }
    };

    const cleanup = () => {
      setDragState(null);
      setHoveredTargetId(null);
      hoveredTargetIdRef.current = null;
      setMousePos(null);
    };

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dragState]);

  const contextValue = useMemo<DependencyDragContextValue>(
    () => ({
      dragState,
      hoveredTargetId,
      startDrag,
      setHoveredTarget,
      getDropResult,
    }),
    [dragState, hoveredTargetId, startDrag, setHoveredTarget, getDropResult]
  );

  return (
    <DependencyDragContext.Provider value={contextValue}>
      {children}
      {dragState &&
        mousePos &&
        createPortal(
          <DependencyDragOverlay
            sourceElement={dragState.sourceElement}
            mousePos={mousePos}
            hoveredTargetId={hoveredTargetId}
            getDropResult={getDropResult}
          />,
          document.body
        )}
    </DependencyDragContext.Provider>
  );
}

function DependencyDragOverlay({
  sourceElement,
  mousePos,
  hoveredTargetId,
  getDropResult,
}: {
  sourceElement: HTMLElement;
  mousePos: { x: number; y: number };
  hoveredTargetId: string | null;
  getDropResult: (targetId: string) => DropResult | null;
}) {
  const sourceRect = sourceElement.getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width / 2;
  const startY = sourceRect.top + sourceRect.height / 2;

  const dropResult = hoveredTargetId ? getDropResult(hoveredTargetId) : null;

  const lineColor = !hoveredTargetId
    ? "rgb(148 163 184)"
    : dropResult?.action === "noop"
      ? "rgb(239 68 68)"
      : dropResult?.action === "remove"
        ? "rgb(245 158 11)"
        : "rgb(34 197 94)";

  return (
    <svg
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      <line
        x1={startX}
        y1={startY}
        x2={mousePos.x}
        y2={mousePos.y}
        stroke={lineColor}
        strokeWidth={2}
        strokeDasharray="6 4"
        strokeOpacity={0.7}
      />
      <circle
        cx={startX}
        cy={startY}
        r={4}
        fill={lineColor}
        fillOpacity={0.7}
      />
      <circle
        cx={mousePos.x}
        cy={mousePos.y}
        r={4}
        fill={lineColor}
        fillOpacity={0.7}
      />
    </svg>
  );
}
