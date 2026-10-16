import { useEffect, useCallback } from "react";
import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { Save } from "lucide-react";
import { ConnectionStatusIndicator } from "@/features/diagrams/connection-status-indicator";
import {
  diagramChannel,
  type ParentToChildMessage,
} from "@/lib/diagram-protocol";
import { usePreserveSnapshotShortcut } from "@/features/diagrams/preserve-snapshot-shortcut";
import { useSnapshotStepShortcut } from "@/features/diagrams/use-snapshot-step-shortcut";
import { useRecentreDiagramShortcut } from "@/features/diagrams/use-recentre-diagram-shortcut";
import { DiagramCenteringDebug } from "@/features/diagrams/diagram-centering-debug";
import { copyDiagramContents } from "@/features/diagrams/copy-scene-to-clipboard";
import { TimelinePanel } from "@/features/diagrams/timeline-panel";
import { DiagramRail } from "@/features/diagrams/diagram-rail";
import { useParams, useNavigate, useRevalidator } from "react-router";
import { NO_TOASTS } from "@/lib/route-toasts";
import type { Route } from "./+types/diagram-playground.$diagramId";
import { loadDiagramPlaygroundActive } from "@/features/diagrams/diagram-playground-active.loader.server";
import { CVM_SHAPE_UTILS } from "@/features/diagrams/cvm-shape-utils";
import { useTldrawLicenseKey } from "@/features/diagrams/use-tldraw-license-key";
import { DiagramEditorBoundary } from "@/features/diagrams/unknown-shape-boundary";
import { CommandPalette } from "@/features/diagrams/palette/command-palette";
import { PlaygroundStatusArea } from "@/features/diagrams/head-load-status";
import { PlaygroundStatusProvider } from "@/features/diagrams/playground-status";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { useDiagramPlaygroundReducer } from "@/features/diagrams/use-diagram-playground-reducer";
import {
  activeSnapshotHash,
  showsCornerButtons,
} from "@/features/diagrams/diagram-playground-selectors";
import { readFullScreen } from "@/features/diagrams/full-screen";

export const handle = NO_TOASTS;

export const loader = loadDiagramPlaygroundActive;

const EMPTY_MIME_TYPES: string[] = [];

const EMPTY_EMBEDS: never[] = [];

const UNSUPPORTED_CONTENT =
  "Images, videos, and embeds aren't supported. Only vector shapes and text are allowed.";

export default function DiagramPlaygroundActive({
  loaderData,
}: Route.ComponentProps) {
  const { diagrams, activeHead } = loaderData;
  const { diagramId } = useParams<{ diagramId: string }>();
  const navigate = useNavigate();
  const {
    state,
    dispatch,
    status,
    editorRef,
    attachEditor,
    flushPendingSave,
    requestRestore,
    reportStoredHead,
  } = useDiagramPlaygroundReducer();

  // Diagrams change elsewhere too (an agent drawing one, another tab): the
  // rail and the Active Diagram's stored head are refetched every 2s.
  useFocusRevalidate({ intervalMs: 2000 });
  useEffect(() => {
    if (!activeHead) return;
    reportStoredHead(activeHead.diagramId, {
      hash: activeHead.headHash,
      updatedAt: activeHead.updatedAt,
    });
  }, [activeHead, reportStoredHead]);

  const reloadScene = useCallback(
    (id: string) => dispatch({ type: "head-moved-elsewhere", diagramId: id }),
    [dispatch]
  );
  const preserveSnapshot = useCallback(
    () => dispatch({ type: "preserve-clicked" }),
    [dispatch]
  );
  const handleCreateDiagram = useCallback(
    () => dispatch({ type: "create-clicked" }),
    [dispatch]
  );

  const recentreDiagram = useCallback(
    () => dispatch({ type: "recentre-requested" }),
    [dispatch]
  );

  usePreserveSnapshotShortcut(diagramId ? preserveSnapshot : null);
  useSnapshotStepShortcut({
    diagramId,
    flushPendingSave,
    onRestoreRequest: requestRestore,
    status,
  });
  useRecentreDiagramShortcut(diagramId ? recentreDiagram : null);

  // Emit activeDiagramChanged on mount
  useEffect(() => {
    if (diagramId) {
      diagramChannel.sendToParent({ type: "activeDiagramChanged", diagramId });
    }
  }, [diagramId]);

  // Load the diagram when navigating between diagrams in this same route.
  useEffect(() => {
    if (diagramId) dispatch({ type: "diagram-opened", diagramId });
  }, [diagramId, dispatch]);

  // Ping the parent every 2s; mark disconnected if no pong within 5s.
  // Re-broadcast activeDiagramChanged alongside each ping so a parent that
  // joined the channel late (e.g. closed and reopened) re-learns the state.
  useEffect(() => {
    let lastPong = 0;
    const unsub = diagramChannel.subscribeChild((msg: ParentToChildMessage) => {
      if (msg.type === "pong" || msg.type === "editorConnected") {
        lastPong = Date.now();
        dispatch({ type: "video-editor-replied" });
      } else if (msg.type === "editorDisconnected") {
        lastPong = 0;
        dispatch({ type: "video-editor-disconnected" });
      } else if (msg.type === "recordingStatus") {
        dispatch({
          type: "recording-status-reported",
          recording: msg.recording,
          format: msg.format,
          fullScreen: readFullScreen(),
        });
      }
    });
    function beat() {
      diagramChannel.sendToParent({ type: "ping" });
      diagramChannel.sendToParent({
        type: "activeDiagramChanged",
        diagramId: diagramId ?? null,
      });
      if (Date.now() - lastPong > 5000) {
        dispatch({ type: "video-editor-went-quiet" });
      }
    }
    const interval = setInterval(beat, 2000);
    beat();
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [diagramId, dispatch]);

  // Listen for parent messages (loadDiagram for switch, flush for save)
  useEffect(() => {
    const unsub = diagramChannel.subscribeChild((msg: ParentToChildMessage) => {
      if (msg.type === "loadDiagram") {
        navigate(`/diagram-playground/${msg.diagramId}`, { replace: true });
      } else if (msg.type === "flush") {
        void flushPendingSave().finally(() => {
          diagramChannel.sendToParent({ type: "flushAck" });
        });
      } else if (msg.type === "snapshotForClip") {
        dispatch({
          type: "clip-snapshot-requested",
          clipId: msg.clipId,
          diagramId: msg.diagramId,
          diagramName:
            diagrams.find((d) => d.id === msg.diagramId)?.name ?? null,
        });
      }
    });
    return unsub;
  }, [navigate, flushPendingSave, dispatch, diagrams]);

  useEffect(() => {
    function onFocus() {
      dispatch({ type: "window-focused" });
      diagramChannel.sendToParent({ type: "focus" });
    }
    function onBlur() {
      dispatch({ type: "window-blurred" });
      diagramChannel.sendToParent({ type: "blur" });
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    if (document.hasFocus()) onFocus();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [dispatch]);

  const handleMount = useCallback(
    (editor: Editor) => {
      attachEditor(editor);

      // A pasted or dropped file would only ever become an image or video,
      // and tldraw's own answer is a toast of its own: say it here instead.
      editor.registerExternalContentHandler("files", () => {
        status.reportError(UNSUPPORTED_CONTENT);
      });
      editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
        if (
          shape.type === "image" ||
          shape.type === "video" ||
          shape.type === "embed"
        ) {
          status.reportError(UNSUPPORTED_CONTENT);
          return undefined as never;
        }
        return shape;
      });

      // Session changes fire on every pointer move; only a flip is news.
      let isFocusMode = editor.getInstanceState().isFocusMode;
      editor.store.listen(
        () => {
          const next = editor.getInstanceState().isFocusMode;
          if (next === isFocusMode) return;
          isFocusMode = next;
          dispatch({ type: "focus-mode-changed", isFocusMode });
        },
        { scope: "session" }
      );

      dispatch({
        type: "editor-mounted",
        diagramId: diagramId ?? null,
        isFocusMode,
      });
    },
    [attachEditor, diagramId, dispatch, status]
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
          status.reportError("Failed to delete diagram");
          return;
        }
        status.reportSuccess();
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
        status.reportError("Failed to delete diagram");
      }
    },
    [diagramId, diagrams, navigate, revalidator, status]
  );

  const openDiagramId = state.head?.diagramId;
  const handleCopyDiagramContents = useCallback(
    async (id: string) => {
      // Copying the OPEN diagram reads its stored head like any other, so the
      // debounced save has to land first or the clipboard is up to 500ms stale.
      if (id === openDiagramId) await flushPendingSave();
      await copyDiagramContents(id, status);
    },
    [flushPendingSave, openDiagramId, status]
  );

  // Leaving waits on the navigation blocker for any edit not yet saved.
  const handleNavigateHome = useCallback(() => {
    diagramChannel.sendToParent({
      type: "activeDiagramChanged",
      diagramId: null,
    });
    navigate("/diagram-playground");
  }, [navigate]);

  const { isFocusMode } = state;
  const timelineVisible = diagramId && !isFocusMode;
  const cornerButtons = showsCornerButtons(state);
  const licenseKey = useTldrawLicenseKey();

  return (
    <PlaygroundStatusProvider value={status}>
      <div className="flex h-screen w-screen">
        <div className="relative flex-1">
          <DiagramEditorBoundary>
            <Tldraw
              licenseKey={licenseKey}
              onMount={handleMount}
              colorScheme="dark"
              acceptedImageMimeTypes={EMPTY_MIME_TYPES}
              acceptedVideoMimeTypes={EMPTY_MIME_TYPES}
              embeds={EMPTY_EMBEDS}
              shapeUtils={CVM_SHAPE_UTILS}
            />
            {diagramId && cornerButtons && (
              <button
                onClick={preserveSnapshot}
                disabled={state.preserving}
                title="Preserve Snapshot"
                aria-label="Preserve Snapshot"
                className="absolute bottom-16 right-2 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 text-zinc-100 shadow hover:bg-zinc-600 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
              </button>
            )}
          </DiagramEditorBoundary>
          <PlaygroundStatusArea
            status={diagramId ? (state.head?.status ?? "loading") : null}
            onRetry={() => dispatch({ type: "retry-load-clicked" })}
            changedElsewhere={state.head?.changedElsewhere ?? false}
            onLoadChanged={() =>
              dispatch({ type: "load-changed-head-clicked" })
            }
            onKeepMine={() => dispatch({ type: "keep-my-edits-clicked" })}
            error={state.error}
          />
          {/* Active Diagram window only — never Playground Home. */}
          {diagramId && (
            <CommandPalette
              diagramId={diagramId}
              editorRef={editorRef}
              flushPendingSave={flushPendingSave}
              preserveSnapshot={preserveSnapshot}
              handleRestoreRequest={requestRestore}
              handleCopyDiagramContents={handleCopyDiagramContents}
              handleCreateDiagram={handleCreateDiagram}
              reloadScene={reloadScene}
              recentreDiagram={recentreDiagram}
            />
          )}
          {cornerButtons && (
            <ConnectionStatusIndicator
              editorConnected={state.videoEditorConnected}
              windowFocused={state.windowFocused}
            />
          )}
          {diagramId && cornerButtons && (
            <DiagramCenteringDebug
              editorRef={editorRef}
              format={state.format}
              onRecentre={recentreDiagram}
            />
          )}
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
                    onRestoreRequest={requestRestore}
                    refreshKey={`${state.timelineVersion}:${activeHead?.timelineHash ?? ""}`}
                    activeContentHash={activeSnapshotHash(state)}
                  />
                </div>
              </div>
            )}
            <div
              className={
                "flex min-h-0 flex-col " +
                (timelineVisible ? "h-1/2" : "flex-1")
              }
            >
              <DiagramRail
                diagrams={diagrams}
                activeDiagramId={diagramId}
                creating={state.creating}
                onNavigateHome={handleNavigateHome}
                onCreateDiagram={handleCreateDiagram}
                onCopyContents={handleCopyDiagramContents}
                onDelete={handleDeleteDiagram}
              />
            </div>
          </div>
        )}
      </div>
    </PlaygroundStatusProvider>
  );
}
