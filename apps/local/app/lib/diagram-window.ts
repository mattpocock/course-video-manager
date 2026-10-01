/**
 * Main-app side of the diagram playground popup. The window, the channel and
 * liveness live in `diagramChannel` (see `popup-channel.ts`); this module adds
 * what only the diagram needs — which diagram is active, and the playground's
 * focus.
 */
import { diagramChannel, type ChildToParentMessage } from "./diagram-protocol";
import { diagramFocus } from "./focus-tracker";

let _activeDiagramId: string | null = null;

// Called once by the VideoEditor component on mount; returns a cleanup.
// This is the listener that makes the playground's indicator authoritative —
// pongs are only sent while an editor is actually mounted.
export function enableVideoEditorMode(): () => void {
  if (typeof window === "undefined") return () => {};
  const unsub = diagramChannel.subscribeParent((msg: ChildToParentMessage) => {
    if (msg.type === "ping") {
      diagramChannel.sendToChild({ type: "pong" });
    } else if (msg.type === "activeDiagramChanged") {
      _activeDiagramId = msg.diagramId;
    } else if (msg.type === "focus") {
      diagramFocus.focus();
    } else if (msg.type === "blur") {
      diagramFocus.blur();
    }
  });
  // Announce ourselves immediately so the playground's indicator flips green
  // without waiting for the next ping cycle. The ping/pong heartbeat remains
  // the source of truth for ongoing liveness.
  diagramChannel.sendToChild({ type: "editorConnected" });
  return () => {
    diagramChannel.sendToChild({ type: "editorDisconnected" });
    unsub();
  };
}

export function openPlayground(): Window | null {
  return diagramChannel.open();
}

export function openPlaygroundWithDiagram(diagramId: string): void {
  if (diagramChannel.isOpen()) {
    diagramChannel.sendToChild({ type: "loadDiagram", diagramId });
  }
  _activeDiagramId = diagramId;
  diagramChannel.open(`/diagram-playground/${diagramId}`);
}

export function getActiveDiagramId(): string | null {
  if (!diagramChannel.isOpen()) return null;
  return _activeDiagramId;
}
