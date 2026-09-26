import { useEffect, useRef } from "react";
import { streamDeckForwarderMessageSchema } from "stream-deck-forwarder/stream-deck-forwarder-types";
import type { ChapterNamingModal } from "../types";

/**
 * Hook that manages WebSocket connection to the Stream Deck forwarder.
 *
 * Connects to localhost:5172 and handles messages from the Stream Deck:
 * - delete-last-clip: Triggers deletion of the most recently inserted clip
 * - toggle-last-frame-of-video: Toggles the last frame setting for clips
 * - toggle-pause: Toggles pause between clips
 * - add-chapter: Opens modal to create a new chapter
 *
 * The socket is opened once per mount and closed on unmount. The handlers are
 * held in a ref rather than listed as effect deps: several of them are inline
 * arrows in the edit route, so a new identity every render. Listing them made
 * every re-render of that route close the socket and open a new one — and the
 * OBS connector re-renders the route on a ~1s beat for as long as OBS is shut,
 * so the hub saw a fresh client roughly every two seconds and logged each one.
 */
export function useWebSocket(params: {
  dispatch: (action: { type: "toggle-last-frame-of-video" }) => void;
  onDeleteLatestInsertedClip: () => void;
  onTogglePause: () => void;
  onClearAllArchived: () => void;
  setChapterNamingModal: (modal: ChapterNamingModal) => void;
  generateDefaultChapterName: () => string;
}) {
  const ref = useRef(params);
  ref.current = params;

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:5172");
    socket.addEventListener("message", (event) => {
      // The hub rebroadcasts every client's messages (Stream Deck actions AND
      // browser link-capture events) to every client. This hook only handles
      // Stream Deck actions, so unrecognized message types are ignored rather
      // than throwing.
      const parsed = streamDeckForwarderMessageSchema.safeParse(
        JSON.parse(event.data)
      );
      if (!parsed.success) return;
      const data = parsed.data;
      const handlers = ref.current;
      if (data.type === "delete-last-clip") {
        handlers.onDeleteLatestInsertedClip();
      } else if (data.type === "toggle-last-frame-of-video") {
        handlers.dispatch({ type: "toggle-last-frame-of-video" });
      } else if (data.type === "toggle-pause") {
        handlers.onTogglePause();
      } else if (data.type === "add-chapter") {
        handlers.setChapterNamingModal({
          mode: "create",
          defaultName: handlers.generateDefaultChapterName(),
        });
      } else if (data.type === "clear-all-archived") {
        handlers.onClearAllArchived();
      }
    });
    return () => {
      socket.close();
    };
  }, []);
}
