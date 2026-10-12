import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { STILL_PATH } from "./protocol";
import { connect, start } from "./test-utils/service-harness";

/** Only CVM's own pages may drive the recorder or read its pictures. */

const CVM = "http://localhost:5173";
const FOREIGN = "https://evil.example";

describe("origins", () => {
  it("refuses a foreign web page on the WebSocket and the pictures, and lets CVM's page read them", async () => {
    const { port } = await start();
    const foreign = new WebSocket(`ws://127.0.0.1:${port}`, {
      origin: FOREIGN,
    });
    const refused = await new Promise((resolve) => {
      foreign.once("open", () => resolve(false));
      foreign.once("error", () => resolve(true));
    });
    expect(refused).toBe(true);

    // The app server's own client sends no Origin.
    const client = await connect(port);
    await client.next("hello");
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");

    for (const path of [STILL_PATH, "/preview/camera", "/preview/screen"]) {
      const url = `http://127.0.0.1:${port}${path}`;
      const bad = await fetch(url, { headers: { Origin: FOREIGN } });
      expect(bad.status).toBe(403);
      expect(bad.headers.get("access-control-allow-origin")).toBeNull();

      const ours = await fetch(url, { headers: { Origin: CVM } });
      expect(ours.headers.get("access-control-allow-origin")).toBe(CVM);
      expect(ours.headers.get("vary")).toBe("Origin");
      await ours.body?.cancel();
    }
  });
});
