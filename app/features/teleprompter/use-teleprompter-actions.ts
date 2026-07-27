/**
 * One input surface: Stream Deck presses (over the
 * forwarder hub at ws://localhost:5172) and the equivalent keyboard shortcuts,
 * so the feel can be judged without touching Stream Deck config first.
 *
 * Connects its own socket rather than reusing the editor's `useWebSocket` —
 * this is a different window, and the hub fans out to every client anyway.
 *
 *   advance / back  →  Stream Deck /api/teleprompter-advance | -back  ·  J/K, ↓/↑, Space
 *   togglePlay      →  /api/teleprompter-toggle-play                  ·  P
 *   reset           →  /api/teleprompter-reset                        ·  R
 * */
import { useEffect, useRef } from "react";
import { streamDeckForwarderMessageSchema } from "stream-deck-forwarder/stream-deck-forwarder-types";

export type TeleprompterActions = {
  advance: () => void;
  back: () => void;
  togglePlay: () => void;
  reset: () => void;
};

export function useTeleprompterActions(actions: TeleprompterActions) {
  // Held in a ref so the socket and key listener are installed once and never
  // torn down by re-renders — a dropped socket mid-take would be the worst
  // possible failure mode for the thing being evaluated.
  const ref = useRef(actions);
  ref.current = actions;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket("ws://localhost:5172");
      socket.addEventListener("message", (event) => {
        let json: unknown;
        try {
          json = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = streamDeckForwarderMessageSchema.safeParse(json);
        if (!parsed.success) return;
        const { type } = parsed.data;
        if (type === "teleprompter-advance") ref.current.advance();
        else if (type === "teleprompter-back") ref.current.back();
        else if (type === "teleprompter-toggle-play") ref.current.togglePlay();
        else if (type === "teleprompter-reset") ref.current.reset();
      });
      // The forwarder may not be up yet (or may restart under `tsx watch`).
      // Retry quietly rather than silently losing the Stream Deck.
      socket.addEventListener("close", () => {
        if (closed) return;
        reconnectTimer = setTimeout(connect, 2000);
      });
      socket.addEventListener("error", () => socket?.close());
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        ref.current.advance();
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        ref.current.back();
      } else if (e.key === "p") {
        e.preventDefault();
        ref.current.togglePlay();
      } else if (e.key === "r") {
        e.preventDefault();
        ref.current.reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
