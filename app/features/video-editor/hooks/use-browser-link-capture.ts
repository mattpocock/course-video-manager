import { useEffect } from "react";
import { browserEventMessageSchema } from "stream-deck-forwarder/stream-deck-forwarder-types";
import { recordBrowserEvent } from "@/lib/browser-link-window";

/**
 * Subscribes to the forwarder hub (ws://localhost:5172) and feeds browser
 * link-capture events from the Chrome extension into the live event log.
 *
 * The extension is a dumb tap that emits `browser-focus` / `browser-url`; this
 * hook simply records them (stamped with the extension's `ts`). The clip window
 * draining happens elsewhere (the edit route's `onClipAudioWindowClosed`).
 *
 * Non-browser messages on the hub (Stream Deck actions) are ignored. The socket
 * is best-effort: if the hub is down there is simply no capture, and the socket
 * is closed on unmount.
 */
export function useBrowserLinkCapture() {
  useEffect(() => {
    const socket = new WebSocket("ws://localhost:5172");
    socket.addEventListener("message", (event) => {
      const parsed = browserEventMessageSchema.safeParse(
        JSON.parse(event.data)
      );
      if (!parsed.success) return;
      recordBrowserEvent(parsed.data);
    });
    return () => {
      socket.close();
    };
  }, []);
}
