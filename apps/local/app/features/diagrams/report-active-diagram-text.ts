import type { Editor } from "tldraw";
import { extractSceneLines } from "@cvm/core/lib/extract-scene-text/index";
import { diagramChannel } from "@/lib/diagram-protocol";
import { every } from "@/packages/clock";

/** As often as the playground pings, so an editor that opens late hears it. */
const REPEAT_MS = 2000;

/**
 * Tell the Video Editor the Diagram Text of what the canvas holds now, one
 * line per shape (so its Suggestions tab can diff it against the last Clip's
 * DiagramSnapshot), for that tab: once at once, again whenever the words change (a move
 * or restyle changes none, so it sends nothing), and again every two seconds.
 * The text is read from the live canvas the way the server derives it, so it
 * does not wait on the head's autosave. With no `diagramId` (Playground
 * Home), and when it stops or the window closes, it reports no diagram.
 * Returns the stop.
 */
export function reportActiveDiagramText(
  editor: Editor,
  diagramId: string | null
): () => void {
  const sendNone = () =>
    diagramChannel.sendToParent({
      type: "activeDiagramText",
      diagramId: null,
      text: "",
    });
  if (!diagramId) {
    sendNone();
    return () => {};
  }
  const read = () =>
    extractSceneLines({ store: editor.store.serialize("document") }).join("\n");
  let text = read();
  const send = () =>
    diagramChannel.sendToParent({ type: "activeDiagramText", diagramId, text });
  send();
  const unlisten = editor.store.listen(
    () => {
      const next = read();
      if (next === text) return;
      text = next;
      send();
    },
    { scope: "document" }
  );
  const stopSend = every(REPEAT_MS, send);
  window.addEventListener("pagehide", sendNone);
  return () => {
    unlisten();
    stopSend();
    window.removeEventListener("pagehide", sendNone);
    sendNone();
  };
}
