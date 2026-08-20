import { useEffect, useRef, useCallback, useState } from "react";
import { Tldraw, getSnapshot, loadSnapshot, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { Save } from "lucide-react";
import { ConnectionStatusIndicator } from "@/features/diagrams/connection-status-indicator";
import { toast } from "sonner";
import {
  subscribeChild,
  sendToParent,
  type ParentToChildMessage,
} from "@/lib/diagram-protocol";
import { RestoreSnapshotDialog } from "@/features/diagrams/restore-snapshot-dialog";
import { renderThumbnailPngBase64 } from "@/features/diagrams/render-thumbnail";
import { usePreserveSnapshotShortcut } from "@/features/diagrams/preserve-snapshot-shortcut";
import { useSnapshotStepShortcut } from "@/features/diagrams/use-snapshot-step-shortcut";
import { useRecentreDiagramShortcut } from "@/features/diagrams/use-recentre-diagram-shortcut";
import { centreCameraOnContent } from "@/features/diagrams/centre-camera-on-content";
import { DiagramCenteringDebug } from "@/features/diagrams/diagram-centering-debug";
import { copyDiagramContents } from "@/features/diagrams/copy-scene-to-clipboard";
import {
  TimelinePanel,
  type Snapshot,
} from "@/features/diagrams/timeline-panel";
import { DiagramRail } from "@/features/diagrams/diagram-rail";
import { useParams, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/diagram-playground.$diagramId";
import { loadDiagramPlaygroundActive } from "@/features/diagrams/diagram-playground-active.loader.server";
import { CVM_SHAPE_UTILS } from "@/features/diagrams/cvm-shape-utils";
import { DiagramEditorBoundary } from "@/features/diagrams/unknown-shape-boundary";
import { DiagramCommandPalette } from "@/features/diagrams/palette/diagram-command-palette";

export const loader = loadDiagramPlaygroundActive;

const DEBOUNCE_MS = 500;

const EMPTY_MIME_TYPES: string[] = [];
const EMPTY_EMBEDS: never[] = [];

export default function DiagramPlaygroundActive({
  loaderData,
}: Route.ComponentProps) {
  const { diagrams } = loaderData;
  const { diagramId } = useParams<{ diagramId: string }>();
  const navigate = useNavigate();
  const editorRef = useRef<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeDiagramId = useRef<string | null>(diagramId ?? null);
  const [preserving, setPreserving] = useState(false);
  const preservingRef = useRef(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingRestore, setPendingRestore] = useState<Snapshot | null>(null);
  const [editorConnected, setEditorConnected] = useState(false);
  const [windowFocused, setWindowFocused] = useState(() =>
    typeof document !== "undefined" ? document.hasFocus() : false
  );
  const [creating, setCreating] = useState(false);
  const initialLoadDone = useRef(false);

  const saveHead = useCallback(async () => {
    const ed = editorRef.current;
    const id = activeDiagramId.current;
    if (!ed || !id) return;
    const { document } = getSnapshot(ed.store);
    try {
      await fetch(`/api/diagrams/${id}/head`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
      });
    } catch {
      // Network errors during autosave are non-fatal
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveHead(), DEBOUNCE_MS);
  }, [saveHead]);

  // Every flow that leaves the current diagram must call this first, or up to
  // 500ms of debounced edits is silently lost.
  const flushPendingSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await saveHead();
  }, [saveHead]);

  const loadDiagramScene = useCallback(
    async (id: string) => {
      const ed = editorRef.current;
      if (!ed) return;

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (activeDiagramId.current && activeDiagramId.current !== id) {
        await saveHead();
      }

      activeDiagramId.current = id;
      setRefreshKey((k) => k + 1);

      try {
        const res = await fetch(`/api/diagrams/${id}/head`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.headScene) {
          loadSnapshot(ed.store, { document: data.headScene });
          // Covers the palette's search restore, which lands here via
          // `reloadScene`, as well as opening or switching diagrams.
          centreCameraOnContent(ed);
        } else {
          ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
        }
      } catch {
        // Failed to load — keep empty canvas
      }
    },
    [saveHead]
  );

  const performRestore = useCallback(async (snapshot: Snapshot) => {
    const ed = editorRef.current;
    const id = activeDiagramId.current;
    if (!ed || !id) return;

    try {
      const res = await fetch(`/api/diagrams/${id}/restore-to-head`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: snapshot.id }),
      });

      if (!res.ok) {
        toast.error("Failed to restore snapshot");
        return;
      }

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      loadSnapshot(ed.store, { document: snapshot.scene as never });
      centreCameraOnContent(ed);
      setRefreshKey((k) => k + 1);
    } catch {
      toast.error("Failed to restore snapshot");
    }
  }, []);

  // Returns a promise that settles when the head has moved, so a caller
  // stepping through the timeline can wait for one restore before aiming the
  // next. The dialog branch settles immediately — it hands control to the
  // dialog, which owns the keyboard until it is answered.
  const handleRestoreRequest = useCallback(
    (snapshot: Snapshot, headIsCaptured: boolean): Promise<void> | void => {
      const ed = editorRef.current;
      const canvasIsEmpty = ed ? ed.getCurrentPageShapeIds().size === 0 : false;
      if (headIsCaptured || canvasIsEmpty) {
        return performRestore(snapshot);
      }
      setPendingRestore(snapshot);
    },
    [performRestore]
  );

  const preserveSnapshot = useCallback(async () => {
    if (preservingRef.current) return;
    const id = activeDiagramId.current;
    const ed = editorRef.current;
    if (!id || !ed) return;

    preservingRef.current = true;
    setPreserving(true);
    try {
      await flushPendingSave();

      let thumbnailPngBase64: string | null;
      try {
        thumbnailPngBase64 = await renderThumbnailPngBase64(ed, "current-page");
      } catch {
        toast.error("Failed to render thumbnail");
        return;
      }
      if (!thumbnailPngBase64) {
        toast.error("Cannot preserve an empty diagram");
        return;
      }

      const res = await fetch(`/api/diagrams/${id}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preserved: true, thumbnailPngBase64 }),
      });
      if (!res.ok) {
        toast.error("Failed to preserve snapshot");
        return;
      }
      const data = await res.json();
      if (data.snapshot) {
        setRefreshKey((k) => k + 1);
      }
    } catch {
      toast.error("Failed to preserve snapshot");
    } finally {
      preservingRef.current = false;
      setPreserving(false);
    }
  }, [saveHead]);

  const recentreDiagram = useCallback(() => {
    const ed = editorRef.current;
    if (ed) centreCameraOnContent(ed);
  }, []);

  usePreserveSnapshotShortcut(diagramId ? preserveSnapshot : null);
  useSnapshotStepShortcut({
    diagramId,
    flushPendingSave,
    onRestoreRequest: handleRestoreRequest,
  });
  useRecentreDiagramShortcut(diagramId ? recentreDiagram : null);

  // Emit activeDiagramChanged on mount
  useEffect(() => {
    if (diagramId) {
      sendToParent({ type: "activeDiagramChanged", diagramId });
    }
  }, [diagramId]);

  // Reload scene when navigating between diagrams in this same route
  useEffect(() => {
    if (
      diagramId &&
      editorRef.current &&
      initialLoadDone.current &&
      activeDiagramId.current !== diagramId
    ) {
      loadDiagramScene(diagramId);
    }
  }, [diagramId, loadDiagramScene]);

  // Ping the parent every 2s; mark disconnected if no pong within 5s.
  // Re-broadcast activeDiagramChanged alongside each ping so a parent that
  // joined the channel late (e.g. closed and reopened) re-learns the state.
  useEffect(() => {
    let lastPong = 0;
    const unsub = subscribeChild((msg: ParentToChildMessage) => {
      if (msg.type === "pong" || msg.type === "editorConnected") {
        lastPong = Date.now();
        setEditorConnected(true);
      } else if (msg.type === "editorDisconnected") {
        lastPong = 0;
        setEditorConnected(false);
      }
    });
    function beat() {
      sendToParent({ type: "ping" });
      sendToParent({
        type: "activeDiagramChanged",
        diagramId: diagramId ?? null,
      });
      if (Date.now() - lastPong > 5000) setEditorConnected(false);
    }
    const interval = setInterval(beat, 2000);
    beat();
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [diagramId]);

  // Listen for parent messages (loadDiagram for switch, flush for save)
  useEffect(() => {
    const unsub = subscribeChild((msg: ParentToChildMessage) => {
      if (msg.type === "loadDiagram") {
        navigate(`/diagram-playground/${msg.diagramId}`, { replace: true });
      } else if (msg.type === "flush") {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        const ed = editorRef.current;
        const id = activeDiagramId.current;
        if (ed && id) {
          const { document } = getSnapshot(ed.store);
          fetch(`/api/diagrams/${id}/head`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(document),
          })
            .catch(() => {})
            .finally(() => {
              sendToParent({ type: "flushAck" });
            });
        } else {
          sendToParent({ type: "flushAck" });
        }
      } else if (msg.type === "snapshotForClip") {
        const { clipId, diagramId: targetDiagramId } = msg;
        void (async () => {
          let ok = false;
          let snapshotId: string | null = null;
          const diagramName =
            diagrams.find((d) => d.id === targetDiagramId)?.name ?? null;
          try {
            const ed = editorRef.current;
            if (!ed || activeDiagramId.current !== targetDiagramId) return;

            if (saveTimer.current) {
              clearTimeout(saveTimer.current);
              saveTimer.current = null;
            }
            await saveHead();

            // Auto-pin thumbnails are best-effort; proceed without one if rendering fails.
            const thumbnailPngBase64 = await renderThumbnailPngBase64(
              ed,
              "current-page"
            ).catch(() => null);

            const res = await fetch(
              `/api/diagrams/${targetDiagramId}/snapshots`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clipId, thumbnailPngBase64 }),
              }
            );
            ok = res.ok;
            if (ok) {
              try {
                const body = await res.json();
                snapshotId = body?.snapshot?.id ?? null;
              } catch {
                // ignore — snapshotId stays null
              }
              setRefreshKey((k) => k + 1);
            }
          } finally {
            sendToParent({
              type: "snapshotForClipDone",
              clipId,
              ok,
              snapshotId,
              diagramName,
            });
          }
        })();
      }
    });
    return unsub;
  }, [navigate, saveHead]);

  useEffect(() => {
    function onFocus() {
      setWindowFocused(true);
      sendToParent({ type: "focus" });
    }
    function onBlur() {
      setWindowFocused(false);
      sendToParent({ type: "blur" });
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    if (document.hasFocus()) {
      setWindowFocused(true);
      sendToParent({ type: "focus" });
    }
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setIsFocusMode(editor.getInstanceState().isFocusMode);

      editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
        if (
          shape.type === "image" ||
          shape.type === "video" ||
          shape.type === "embed"
        ) {
          toast.warning(
            "Images, videos, and embeds are not supported in v1. Only vector shapes and text are allowed."
          );
          return undefined as never;
        }
        return shape;
      });

      editor.store.listen(
        () => {
          if (activeDiagramId.current) {
            scheduleSave();
          }
        },
        { source: "user", scope: "document" }
      );

      editor.store.listen(
        () => {
          setIsFocusMode(editor.getInstanceState().isFocusMode);
        },
        { scope: "session" }
      );

      // Load initial diagram from URL param
      if (diagramId && !initialLoadDone.current) {
        initialLoadDone.current = true;
        loadDiagramScene(diagramId);
      }
    },
    [scheduleSave, diagramId, loadDiagramScene]
  );

  const revalidator = useRevalidator();
  const handleDeleteDiagram = useCallback(
    async (id: string) => {
      try {
        const fd = new FormData();
        fd.set("archived", "true");
        const res = await fetch(`/api/diagrams/${id}/update`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          toast.error("Failed to delete diagram");
          return;
        }
        if (id === diagramId) {
          const idx = diagrams.findIndex((d) => d.id === id);
          const neighbor =
            (idx >= 0 ? diagrams[idx + 1] : undefined) ??
            (idx > 0 ? diagrams[idx - 1] : undefined);
          if (neighbor) {
            navigate(`/diagram-playground/${neighbor.id}`);
          } else {
            navigate("/diagram-playground");
          }
        } else {
          revalidator.revalidate();
        }
      } catch {
        toast.error("Failed to delete diagram");
      }
    },
    [diagramId, diagrams, navigate, revalidator]
  );

  const handleCopyDiagramContents = useCallback(
    async (id: string) => {
      // Copying the OPEN diagram reads its stored head like any other, so the
      // debounced save has to land first or the clipboard is up to 500ms stale.
      if (id === activeDiagramId.current) await flushPendingSave();
      await copyDiagramContents(id);
    },
    [flushPendingSave]
  );

  const handleCreateDiagram = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      await flushPendingSave();
      const res = await fetch("/api/diagrams/create", { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to create diagram");
        return;
      }
      const { id } = await res.json();
      navigate(`/diagram-playground/${id}`);
    } catch {
      toast.error("Failed to create diagram");
    } finally {
      setCreating(false);
    }
  }, [creating, saveHead, navigate]);

  const handleNavigateHome = useCallback(async () => {
    await flushPendingSave();
    sendToParent({ type: "activeDiagramChanged", diagramId: null });
    navigate("/diagram-playground");
  }, [saveHead, navigate]);

  const timelineVisible = diagramId && !isFocusMode;

  return (
    <div className="flex h-screen w-screen">
      <div className="relative flex-1">
        <DiagramEditorBoundary>
          <Tldraw
            onMount={handleMount}
            colorScheme="dark"
            acceptedImageMimeTypes={EMPTY_MIME_TYPES}
            acceptedVideoMimeTypes={EMPTY_MIME_TYPES}
            embeds={EMPTY_EMBEDS}
            shapeUtils={CVM_SHAPE_UTILS}
          />
          {diagramId && (
            <button
              onClick={preserveSnapshot}
              disabled={preserving}
              title="Preserve Snapshot"
              aria-label="Preserve Snapshot"
              className="absolute bottom-16 right-2 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 text-zinc-100 shadow hover:bg-zinc-600 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
            </button>
          )}
        </DiagramEditorBoundary>
        {/* Active Diagram window only — never Playground Home. */}
        {diagramId && (
          <DiagramCommandPalette
            diagramId={diagramId}
            editorRef={editorRef}
            flushPendingSave={flushPendingSave}
            preserveSnapshot={preserveSnapshot}
            handleRestoreRequest={handleRestoreRequest}
            handleCopyDiagramContents={handleCopyDiagramContents}
            handleCreateDiagram={handleCreateDiagram}
            reloadScene={loadDiagramScene}
          />
        )}
        <ConnectionStatusIndicator
          editorConnected={editorConnected}
          windowFocused={windowFocused}
        />
        {diagramId && <DiagramCenteringDebug editorRef={editorRef} />}
      </div>
      {!isFocusMode && (
        <div className="flex w-64 shrink-0 flex-col border-l border-zinc-700 bg-zinc-900">
          {timelineVisible && (
            <div className="flex h-1/2 min-h-0 flex-col border-b border-zinc-700">
              <div className="border-b border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300">
                Snapshot Timeline
              </div>
              <div className="flex-1 overflow-y-auto">
                <TimelinePanel
                  diagramId={diagramId}
                  onRestoreRequest={handleRestoreRequest}
                  refreshKey={refreshKey}
                />
              </div>
            </div>
          )}
          <div
            className={
              "flex min-h-0 flex-col " + (timelineVisible ? "h-1/2" : "flex-1")
            }
          >
            <DiagramRail
              diagrams={diagrams}
              activeDiagramId={diagramId}
              creating={creating}
              onNavigateHome={handleNavigateHome}
              onCreateDiagram={handleCreateDiagram}
              onCopyContents={handleCopyDiagramContents}
              onDelete={handleDeleteDiagram}
            />
          </div>
        </div>
      )}
      <RestoreSnapshotDialog
        pendingRestore={pendingRestore}
        onDismiss={() => setPendingRestore(null)}
        onConfirm={performRestore}
      />
    </div>
  );
}
