import {
  sendToChild,
  subscribeParent,
  type ChildToParentMessage,
} from "./diagram-protocol";
import {
  notifyDiagramBlur,
  notifyDiagramFocus,
} from "./diagram-focus-tracking";

const PLAYGROUND_PATH = "/diagram-playground";
const WINDOW_NAME = "cvm-diagrams";
const POPUP_FEATURES = "popup,width=1100,height=800";
const PLAYGROUND_ALIVE_WINDOW_MS = 5000;

let _activeDiagramId: string | null = null;
let lastPingAt = 0;
let livenessSubscribed = false;
let popupRef: Window | null = null;

// Liveness tracking runs in every tab that imports diagram-window so the
// launcher (sidebar) knows whether a popup is alive. It does NOT pong —
// the playground's "Editor connected" indicator only goes green when a
// real Video Editor is mounted (see enableVideoEditorMode).
function ensureLivenessTracker(): void {
  if (livenessSubscribed) return;
  if (typeof window === "undefined") return;
  livenessSubscribed = true;
  subscribeParent((msg: ChildToParentMessage) => {
    if (msg.type === "ping") lastPingAt = Date.now();
  });
}

// Called once by the VideoEditor component on mount; returns a cleanup.
// This is the listener that makes the playground's indicator authoritative —
// pongs are only sent while an editor is actually mounted.
export function enableVideoEditorMode(): () => void {
  if (typeof window === "undefined") return () => {};
  const unsub = subscribeParent((msg: ChildToParentMessage) => {
    if (msg.type === "ping") {
      sendToChild({ type: "pong" });
    } else if (msg.type === "activeDiagramChanged") {
      _activeDiagramId = msg.diagramId;
    } else if (msg.type === "focus") {
      notifyDiagramFocus();
    } else if (msg.type === "blur") {
      notifyDiagramBlur();
    }
  });
  // Announce ourselves immediately so the playground's indicator flips green
  // without waiting for the next ping cycle. The ping/pong heartbeat remains
  // the source of truth for ongoing liveness.
  sendToChild({ type: "editorConnected" });
  return () => {
    sendToChild({ type: "editorDisconnected" });
    unsub();
  };
}

function isPlaygroundAlive(): boolean {
  if (popupRef && popupRef.closed) {
    popupRef = null;
    lastPingAt = 0;
    return false;
  }
  return Date.now() - lastPingAt < PLAYGROUND_ALIVE_WINDOW_MS;
}

export function openPlayground(): Window | null {
  if (isPlaygroundAlive() && popupRef) {
    popupRef.focus();
    return popupRef;
  }
  const w = window.open(PLAYGROUND_PATH, WINDOW_NAME, POPUP_FEATURES);
  if (w) popupRef = w;
  w?.focus();
  return w;
}

export function openPlaygroundWithDiagram(diagramId: string): void {
  if (isPlaygroundAlive() && popupRef) {
    sendToChild({ type: "loadDiagram", diagramId });
    _activeDiagramId = diagramId;
    popupRef.focus();
    return;
  }
  _activeDiagramId = diagramId;
  const w = window.open(
    `${PLAYGROUND_PATH}/${diagramId}`,
    WINDOW_NAME,
    POPUP_FEATURES
  );
  if (w) popupRef = w;
  w?.focus();
}

export function getActiveDiagramId(): string | null {
  if (!isPlaygroundAlive()) return null;
  return _activeDiagramId;
}

export function flushDiagramPlayground(): Promise<void> {
  if (!isPlaygroundAlive()) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve();
    }, 5000);
    const unsub = subscribeParent((msg) => {
      if (msg.type === "flushAck") {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
    sendToChild({ type: "flush" });
  });
}

ensureLivenessTracker();
