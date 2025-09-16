import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { type StreamDeckForwarderMessage } from "./stream-deck-forwarder-types";

const wss = new WebSocketServer({ port: 5172 }, () => {
  console.log("Stream Deck Forwarder server started on port 5172");
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
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello, world!");
});

httpServer.listen(5174, () => {
  console.log("HTTP server started on port 5174");
});
