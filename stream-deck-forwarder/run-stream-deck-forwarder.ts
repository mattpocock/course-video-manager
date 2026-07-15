import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { type StreamDeckForwarderMessage } from "./stream-deck-forwarder-types";

export const DEFAULT_WS_PORT = 5172;
export const DEFAULT_HTTP_PORT = 5174;

/**
 * Starts the Stream Deck forwarder: a WebSocket broadcast hub plus an HTTP
 * server that turns Stream Deck button presses into broadcast messages.
 *
 * The hub fans out in two directions:
 *   - Stream Deck presses hit the HTTP endpoints and are broadcast to every
 *     connected client.
 *   - Anything a client sends over the socket is rebroadcast to every *other*
 *     client, so producers like the browser link-capture extension can reach
 *     the Video Editor over the same hub.
 *
 * Ports are injectable so this can be started on ephemeral ports in tests.
 */
export function startStreamDeckForwarder(opts?: {
  wsPort?: number;
  httpPort?: number;
}) {
  const wsPort = opts?.wsPort ?? DEFAULT_WS_PORT;
  const httpPort = opts?.httpPort ?? DEFAULT_HTTP_PORT;

  const wss = new WebSocketServer({ port: wsPort }, () => {
    console.log(`Stream Deck Forwarder server started on port ${wsPort}`);
  });

  const clients = new Map<string, WebSocket>();

  const sendMessage = (message: StreamDeckForwarderMessage) => {
    clients.values().forEach((client) => {
      client.send(JSON.stringify(message));
    });
  };

  wss.on("connection", (ws) => {
    console.log("Client connected");
    const connectionId = crypto.randomUUID();
    clients.set(connectionId, ws);

    // Rebroadcast anything a client sends over the socket to every other client.
    // Stream Deck actions arrive via the HTTP endpoints below, but other
    // producers (e.g. the browser link-capture extension emitting
    // browser-focus/browser-url) send directly over the socket and rely on the
    // hub fanning them out to the Video Editor. The payload is forwarded
    // verbatim so any message family passes through untouched.
    ws.on("message", (data, isBinary) => {
      const payload = isBinary ? data : data.toString();
      for (const [id, client] of clients) {
        if (id === connectionId) continue;
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    });

    ws.on("close", () => {
      clients.delete(connectionId);
    });
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      clients.delete(connectionId);
    });
  });

  const httpServer = http.createServer((req, res) => {
    if (req.url === "/api/delete-last-clip") {
      sendMessage({
        type: "delete-last-clip",
      });
    } else if (req.url === "/api/toggle-last-frame-of-video") {
      sendMessage({
        type: "toggle-last-frame-of-video",
      });
    } else if (req.url === "/api/toggle-pause") {
      sendMessage({
        type: "toggle-pause",
      });
    } else if (req.url === "/api/add-chapter") {
      sendMessage({
        type: "add-chapter",
      });
    } else if (req.url === "/api/clear-all-archived") {
      sendMessage({
        type: "clear-all-archived",
      });
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello, world!");
  });

  httpServer.listen(httpPort, () => {
    console.log(`HTTP server started on port ${httpPort}`);
  });

  return { wss, httpServer, sendMessage };
}

// Auto-start when run as the process entry point (e.g. `tsx run-…`), but not
// when imported by tests.
if (!process.env.VITEST) {
  startStreamDeckForwarder();
}
