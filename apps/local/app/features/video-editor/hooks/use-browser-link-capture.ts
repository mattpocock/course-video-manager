import { useEffect } from "react";
import { browserEventMessageSchema } from "stream-deck-forwarder/stream-deck-forwarder-types";
import type { BrowserLinkEvent } from "@/lib/clip-web-link";

/**
 * Subscribes to the forwarder hub (ws://localhost:5172) and forwards browser
 * link-capture events from the Chrome extension to `onEvent`.
 *
 * The extension is a dumb tap that emits `browser-focus` / `browser-url`; this
 * hook simply parses them (stamped with the extension's `ts`) and hands them to
 * the caller, which dispatches them into the clip reducer. All folding and
 * per-clip accumulation lives in the reducer — this hook holds no state.
 *
 * Non-browser messages on the hub (Stream Deck actions) are ignored. The socket
 * is best-effort: if the hub is down there is simply no capture, and the socket
 * is closed on unmount.
 */
export function useBrowserLinkCapture(
  onEvent: (event: BrowserLinkEvent) => void
) {
  useEffect(() => {
    const socket = new WebSocket("ws://localhost:5172");
    socket.addEventListener("message", (event) => {
      let json: unknown;
      try {
        json = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = browserEventMessageSchema.safeParse(json);
      if (!parsed.success) return;
      onEvent(parsed.data);
    });
    return () => {
      socket.close();
    };
    // The socket is opened once; `onEvent` is captured on mount. Callers pass a
    // stable dispatch, so we intentionally do not re-subscribe on identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
