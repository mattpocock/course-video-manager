/**
 * Main-app side of the diagram playground popup. The window, the channel and
 * liveness live in `diagramChannel` (see `popup-channel.ts`); this module adds
 * what only the diagram needs — which diagram is active, and the playground's
 * focus.
 */
import { diagramChannel, type ChildToParentMessage } from "./diagram-protocol";
import { diagramFocus } from "./focus-tracker";
import type { VideoFormat } from "@/features/videos/video-format";

let _activeDiagramId: string | null = null;
let _recording = false;
let _format: VideoFormat = "landscape";

// Called once by the VideoEditor component on mount; returns a cleanup.
// This is the listener that makes the playground's indicator authoritative —
// pongs are only sent while an editor is actually mounted.
export function enableVideoEditorMode(): () => void {
  if (typeof window === "undefined") return () => {};
  const unsub = diagramChannel.subscribeParent((msg: ChildToParentMessage) => {
    if (msg.type === "ping") {
      diagramChannel.sendToChild({ type: "pong" });
      // Repeated so a playground opened mid-recording still learns of it.
      diagramChannel.sendToChild({
        type: "recordingStatus",
        recording: _recording,
        format: _format,
      });
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

/**
 * Called by the Video Editor whenever the CVM recorder starts or stops
 * recording. The playground hides its sidebar while a
 * recording is in progress, and centres the diagram as one starts, for the
 * Video's `format`.
 */
export function pushDiagramRecordingStatus(
  recording: boolean,
  format: VideoFormat
): void {
  _recording = recording;
  _format = format;
  diagramChannel.sendToChild({ type: "recordingStatus", recording, format });
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
