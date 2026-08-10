import { useEffect } from "react";
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
 * The socket is automatically closed when the component unmounts.
 */
export function useWebSocket(params: {
  dispatch: (action: { type: "toggle-last-frame-of-video" }) => void;
  onDeleteLatestInsertedClip: () => void;
  onTogglePause: () => void;
  onClearAllArchived: () => void;
  setChapterNamingModal: (modal: ChapterNamingModal) => void;
  generateDefaultChapterName: () => string;
}) {
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
      if (data.type === "delete-last-clip") {
        params.onDeleteLatestInsertedClip();
      } else if (data.type === "toggle-last-frame-of-video") {
        params.dispatch({ type: "toggle-last-frame-of-video" });
      } else if (data.type === "toggle-pause") {
        params.onTogglePause();
      } else if (data.type === "add-chapter") {
        params.setChapterNamingModal({
          mode: "create",
          defaultName: params.generateDefaultChapterName(),
        });
      } else if (data.type === "clear-all-archived") {
        params.onClearAllArchived();
      }
    });
    return () => {
      socket.close();
    };
  }, [
    params.dispatch,
    params.onDeleteLatestInsertedClip,
    params.onTogglePause,
    params.onClearAllArchived,
    params.setChapterNamingModal,
    params.generateDefaultChapterName,
  ]);
}
