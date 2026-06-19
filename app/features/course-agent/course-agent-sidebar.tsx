"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CourseAgentPanel } from "./course-agent-panel";

const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 400;
const STORAGE_KEY = "agent-sidebar-width";

export const SIDEBAR_WIDTH_VAR = "--agent-sidebar-width";

export function setSidebarWidthVar(width: number): void {
  document.documentElement.style.setProperty(SIDEBAR_WIDTH_VAR, `${width}px`);
}

export function clearSidebarWidthVar(): void {
  document.documentElement.style.removeProperty(SIDEBAR_WIDTH_VAR);
}

export function clampWidth(w: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

export function loadSidebarWidth(): number {
  if (typeof localStorage === "undefined") return DEFAULT_WIDTH;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null) return DEFAULT_WIDTH;
  const n = Number(raw);
  if (Number.isNaN(n)) return DEFAULT_WIDTH;
  return clampWidth(n);
}

export function saveSidebarWidth(width: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, String(width));
}

type SidebarProps = {
  courseId: string;
  versionId?: string;
  onClose: () => void;
};

export function CourseAgentSidebar(props: SidebarProps) {
  const [width, setWidth] = useState(loadSidebarWidth);
  const draggingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = clampWidth(window.innerWidth - e.clientX);
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setWidth((w) => {
        saveSidebarWidth(w);
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    setSidebarWidthVar(width);
    return clearSidebarWidthVar;
  }, [width]);

  return (
    <aside
      style={{ width }}
      className="sticky top-0 h-screen shrink-0 border-l border-border bg-card"
    >
      <div
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "col-resize";
        }}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary/30"
        title="Drag to resize"
      />
      <CourseAgentPanel embedded {...props} />
    </aside>
  );
}

export function AgentEdgeTab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title="Open course agent"
      className="fixed right-0 top-8 z-30 flex items-center gap-1.5 rounded-l-md bg-primary py-3 pl-2 pr-1.5 text-primary-foreground shadow-md hover:pr-2.5"
    >
      <Sparkles className="size-4" />
      <span className="[writing-mode:vertical-rl] text-xs font-medium tracking-wide">
        Course Agent
      </span>
    </button>
  );
}
