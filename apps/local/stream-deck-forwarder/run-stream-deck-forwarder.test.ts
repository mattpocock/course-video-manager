import { describe, it, expect, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocket as WsClient, WebSocketServer } from "ws";
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

async function startHub(recorderUrl?: string) {
  const { wss, httpServer } = startStreamDeckForwarder({
    wsPort: 0,
    httpPort: 0,
    recorderUrl,
  });
  await new Promise<void>((r) => wss.once("listening", r));
  if (!httpServer.listening)
    await new Promise<void>((r) => httpServer.once("listening", r));
  const port = (wss.address() as AddressInfo).port;
  const httpPort = (httpServer.address() as AddressInfo).port;
  stop = () =>
    new Promise<void>((resolve) => {
      wss.close(() => httpServer.close(() => resolve()));
    });
  return { port, httpPort };
}

/** A stand-in recorder service: every command it is sent. */
async function startRecorder() {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => server.once("listening", r));
  const commands: unknown[] = [];
  server.on("connection", (ws) =>
    ws.on("message", (data) => commands.push(JSON.parse(data.toString())))
  );
  const before = stop;
  stop = async () => {
    await before?.();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    commands,
  };
}

describe("stream deck forwarder hub", () => {
  it("rebroadcasts a client's message to every other client", async () => {
    const { port } = await startHub();
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
    const { port } = await startHub();
    const sender = await openClient(port);

    let echoed = false;
    sender.once("message", () => {
      echoed = true;
    });
    sender.send(
      JSON.stringify({ type: "browser-focus", focused: true, ts: 1 })
    );

    await new Promise((r) => setTimeout(r, 200));
    expect(echoed).toBe(false);
    sender.close();
  });

  it("passes the New recorder's buttons to the recorder service, not the hub; the editor's buttons still go to the hub", async () => {
    const recorder = await startRecorder();
    const hub = await startHub(recorder.url);
    const editor = await openClient(hub.port);
    const heard: unknown[] = [];
    editor.on("message", (data) => heard.push(JSON.parse(data.toString())));

    for (const path of [
      "start-recording",
      "scene-camera",
      "scene-code",
      "scene-no-face",
      "stop-recording",
      "delete-last-clip",
      "add-chapter",
    ]) {
      await fetch(`http://localhost:${hub.httpPort}/api/${path}`);
    }

    await vi.waitFor(() => expect(recorder.commands).toHaveLength(5));
    expect(recorder.commands).toEqual(
      expect.arrayContaining([
        { type: "stream-deck", press: { action: "record" } },
        {
          type: "stream-deck",
          press: { action: "switch-scene", scene: "Camera" },
        },
        {
          type: "stream-deck",
          press: { action: "switch-scene", scene: "Code" },
        },
        {
          type: "stream-deck",
          press: { action: "switch-scene", scene: "No Face" },
        },
        { type: "stream-deck", press: { action: "stop" } },
      ])
    );
    await vi.waitFor(() =>
      expect(heard).toEqual([
        { type: "delete-last-clip" },
        { type: "add-chapter" },
      ])
    );
    editor.close();
  });
});
