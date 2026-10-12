import { describe, expect, it, vi } from "vitest";
import { STILL_PATH, STILL_RECORDER_CLOSED } from "./protocol";
import { FAKE_STILL_JPEG } from "./test-utils/fake-windows";
import { connect, start } from "./test-utils/service-harness";

/** The thumbnail camera's still, over the recorder service's HTTP port. */

describe("a still", () => {
  it("is the camera's latest still frame while the recorder is open, and a clear error when it is not", async () => {
    const { port } = await start();
    const client = await connect(port);
    await client.next("hello");
    const url = `http://127.0.0.1:${port}${STILL_PATH}`;

    const closed = await fetch(url);
    expect(closed.status).toBe(409);
    expect(await closed.text()).toBe(STILL_RECORDER_CLOSED);

    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    await vi.waitFor(async () => {
      const still = await fetch(url);
      expect(still.status).toBe(200);
      expect(still.headers.get("content-type")).toBe("image/jpeg");
      expect(Buffer.from(await still.arrayBuffer())).toEqual(FAKE_STILL_JPEG);
    });
  });
});
