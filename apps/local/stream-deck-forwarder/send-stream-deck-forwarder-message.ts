import { once } from "node:events";
import {
  createStreamDeckForwarderMessage,
  type StreamDeckForwarderMessage,
} from "./stream-deck-forwarder-types";

declare global {
  var streamDeckForwarderWebSocket: WebSocket | null;
}

export const sendStreamDeckForwarderMessage = async (
  message: StreamDeckForwarderMessage
) => {
  if (!global.streamDeckForwarderWebSocket) {
    global.streamDeckForwarderWebSocket = new WebSocket("ws://localhost:5172");
  }
  let ws = global.streamDeckForwarderWebSocket;

  if (
    ws.readyState === WebSocket.CLOSED ||
    ws.readyState === WebSocket.CLOSING
  ) {
    global.streamDeckForwarderWebSocket = new WebSocket("ws://localhost:5172");
    ws = global.streamDeckForwarderWebSocket;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    await once(ws, "open");
  }

  ws.send(createStreamDeckForwarderMessage(message));
};
