import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  STREAM_DECK_RECORDER_PRESSES,
  type StreamDeckForwarderMessage,
} from "./stream-deck-forwarder-types";
import {
  RECORDER_SERVICE_PORT,
  type RecorderCommand,
  type StreamDeckPress,
} from "../recorder-service/protocol";
import { createConnectionLog } from "./connection-log";
import { forwarderRefusal } from "../live-desk/live-desk";

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
 * The New recorder's buttons (`STREAM_DECK_RECORDER_PRESSES`) skip the hub:
 * each press is sent to the recorder service, which acts on it.
 *
 * Ports are injectable so this can be started on ephemeral ports in tests.
 */
export function startStreamDeckForwarder(opts?: {
  wsPort?: number;
  httpPort?: number;
  /** The recorder service's WebSocket. */
  recorderUrl?: string;
}) {
  const wsPort = opts?.wsPort ?? DEFAULT_WS_PORT;
  const httpPort = opts?.httpPort ?? DEFAULT_HTTP_PORT;
  const recorderUrl =
    opts?.recorderUrl ?? `ws://127.0.0.1:${RECORDER_SERVICE_PORT}`;

  /** One short connection per press: a press is rare, and the service may restart between. */
  const pressRecorder = (press: StreamDeckPress) => {
    const command: RecorderCommand = { type: "stream-deck", press };
    const ws = new WebSocket(recorderUrl);
    ws.once("open", () => ws.send(JSON.stringify(command), () => ws.close()));
    ws.once("error", (error) =>
      console.error(
        `Stream Deck: the recorder service did not take ${press.action} (${recorderUrl}): ${error.message}`
      )
    );
  };

  const wss = new WebSocketServer({ port: wsPort }, () => {
    console.log(`Stream Deck Forwarder server started on port ${wsPort}`);
  });

  const clients = new Map<string, WebSocket>();

  const sendMessage = (message: StreamDeckForwarderMessage) => {
    clients.values().forEach((client) => {
      client.send(JSON.stringify(message));
    });
  };

  // Names the connecting page and collapses a churning one, so a client that
  // reopens its socket on a timer can no longer bury the log.
  const connectionLog = createConnectionLog();

  wss.on("connection", (ws, req) => {
    const connectionId = crypto.randomUUID();
    clients.set(connectionId, ws);

    const line = connectionLog.onConnect({
      origin: req.headers.origin,
      clientCount: clients.size,
    });
    if (line) console.log(line);

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
    const recorderPress = STREAM_DECK_RECORDER_PRESSES[req.url ?? ""];
    if (recorderPress) {
      pressRecorder(recorderPress);
    } else if (req.url === "/api/delete-last-clip") {
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
    } else if (req.url === "/api/teleprompter-advance") {
      sendMessage({
        type: "teleprompter-advance",
      });
    } else if (req.url === "/api/teleprompter-back") {
      sendMessage({
        type: "teleprompter-back",
      });
    } else if (req.url === "/api/teleprompter-toggle-play") {
      sendMessage({
        type: "teleprompter-toggle-play",
      });
    } else if (req.url === "/api/teleprompter-reset") {
      sendMessage({
        type: "teleprompter-reset",
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
// when imported by tests — and only from the main checkout. Exits 0 when
// refused so `pnpm dev` in a worktree carries on without it.
if (!process.env.VITEST) {
  const refusal = forwarderRefusal(process.cwd());
  if (refusal) {
    console.log(refusal);
  } else {
    startStreamDeckForwarder();
  }
}
