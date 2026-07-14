import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocket as WsClient } from "ws";
import { startStreamDeckForwarder } from "./run-stream-deck-forwarder";

// Integration test for the hub's client-message rebroadcast — the path the
// browser link-capture extension relies on. Runs on ephemeral ports so it never
// collides with a running dev server.

let stop: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (stop) await stop();
  stop = null;
});

const openClient = (port: number) =>
  new Promise<WsClient>((resolve, reject) => {
    const ws = new WsClient(`ws://localhost:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });

async function startHub() {
  const { wss, httpServer } = startStreamDeckForwarder({
    wsPort: 0,
    httpPort: 0,
  });
  await new Promise<void>((r) => wss.once("listening", r));
  const port = (wss.address() as AddressInfo).port;
  stop = () =>
    new Promise<void>((resolve) => {
      wss.close(() => httpServer.close(() => resolve()));
    });
  return port;
}

describe("stream deck forwarder hub", () => {
  it("rebroadcasts a client's message to every other client", async () => {
    const port = await startHub();
    const receiver = await openClient(port);
    const received = new Promise<string>((resolve) => {
      receiver.once("message", (data) => resolve(data.toString()));
    });

    const sender = await openClient(port);
    const payload = JSON.stringify({
      type: "browser-url",
      url: "https://example.com",
      ts: 1,
    });
    sender.send(payload);

    expect(await received).toBe(payload);
    receiver.close();
    sender.close();
  });

  it("does not echo a message back to the client that sent it", async () => {
    const port = await startHub();
    const sender = await openClient(port);

    let echoed = false;
    sender.once("message", () => {
      echoed = true;
    });
    sender.send(JSON.stringify({ type: "browser-focus", focused: true, ts: 1 }));

    await new Promise((r) => setTimeout(r, 200));
    expect(echoed).toBe(false);
    sender.close();
  });
});
