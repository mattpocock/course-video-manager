import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewOutput } from "./capture-args";
import {
  PREVIEW_CHUNK,
  startPreviewFeeds,
  type PreviewFeeds,
} from "./preview-feeds";
import { flvHeader, flvVideoTag, previewChunks } from "./test-utils/flv";

/**
 * A preview is relayed to the browser as H.264 the moment each frame is in
 * (#2192): the decoder's config, then the frames since the last keyframe,
 * then each new one. Never a backlog.
 */

let feeds: PreviewFeeds | undefined;
let server: http.Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  server?.close();
  await feeds?.close();
});

const start = async () => {
  feeds = await startPreviewFeeds();
  const f = feeds;
  server = http.createServer((req, res) => {
    if (!f.serve(req, res, {})) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  /** A browser watching the camera preview: every chunk it has read so far. */
  const watch = () => {
    let bytes = Buffer.alloc(0);
    const req = http.get(`http://127.0.0.1:${port}/preview/camera`, (res) =>
      res.on("data", (c: Buffer) => (bytes = Buffer.concat([bytes, c])))
    );
    return {
      chunks: () => previewChunks(bytes),
      stop: () => req.destroy(),
    };
  };
  return { f, watch };
};

/** ffmpeg.exe's side of the camera feed, writing FLV. */
const ffmpegTo = async (f: PreviewFeeds) => {
  const socket = net.connect(f.port("camera"), "127.0.0.1");
  await new Promise((r) => socket.once("connect", r));
  socket.write(
    Buffer.concat([flvHeader(), flvVideoTag({ config: Buffer.from("avcC") })])
  );
  let frames = 0;
  return {
    socket,
    frame: async (key: boolean, body: string) => {
      frames += 1;
      const seen = frames;
      let count = 0;
      const unsubscribe = f.onFrame("camera", () => (count += 1));
      socket.write(flvVideoTag({ key, data: Buffer.from(body) }));
      await vi.waitFor(() => expect(count).toBeGreaterThan(0));
      unsubscribe();
      return seen;
    },
  };
};

const text = (chunks: { kind: number; data: Buffer }[]) =>
  chunks.map((c) => `${c.kind}:${c.data.toString()}`);

describe("a streamed preview", () => {
  it("starts a browser that joins late at the last keyframe, then sends each frame as it comes", async () => {
    const { f, watch } = await start();
    const ffmpeg = await ffmpegTo(f);
    await ffmpeg.frame(true, "k1");
    await ffmpeg.frame(false, "d1");
    await ffmpeg.frame(true, "k2");
    await ffmpeg.frame(false, "d2");
    const browser = watch();
    await vi.waitFor(() => expect(browser.chunks()).toHaveLength(3));
    await ffmpeg.frame(false, "d3");
    await vi.waitFor(() =>
      expect(text(browser.chunks())).toEqual([
        `${PREVIEW_CHUNK.config}:avcC`,
        `${PREVIEW_CHUNK.key}:k2`,
        `${PREVIEW_CHUNK.delta}:d2`,
        `${PREVIEW_CHUNK.delta}:d3`,
      ])
    );
    browser.stop();
    ffmpeg.socket.destroy();
  });

  it("hands on a frame split across reads whole, and not before its last byte", async () => {
    const { f, watch } = await start();
    const ffmpeg = await ffmpegTo(f);
    const browser = watch();
    await vi.waitFor(() => expect(browser.chunks()).toHaveLength(1));
    const tag = flvVideoTag({ key: true, data: Buffer.from("a whole frame") });
    ffmpeg.socket.write(tag.subarray(0, 15));
    await new Promise((r) => setTimeout(r, 30));
    expect(browser.chunks()).toHaveLength(1);
    ffmpeg.socket.write(tag.subarray(15));
    await vi.waitFor(() =>
      expect(text(browser.chunks()).at(-1)).toBe(
        `${PREVIEW_CHUNK.key}:a whole frame`
      )
    );
    browser.stop();
    ffmpeg.socket.destroy();
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("a preview from the real ffmpeg", () => {
  it("relays `previewOutput`'s H.264 as the decoder's config, then a keyframe a GOP", async () => {
    const { f, watch } = await start();
    const browser = watch();
    // A synthetic picture, never a device: two seconds at 30 fps.
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=30",
        "-t",
        "2",
        "-map",
        "0:v",
        // libx264, the fallback: CI has no GPU.
        ...previewOutput(f.port("camera"), 30, "x264"),
      ],
      { stdio: "ignore" }
    );
    const exited = new Promise((r) => ffmpeg.once("exit", r));
    await exited;
    await vi.waitFor(() => expect(browser.chunks().length).toBeGreaterThan(59));
    const kinds = browser.chunks().map((c) => c.kind);
    expect(kinds[0]).toBe(PREVIEW_CHUNK.config);
    // The avcC record: version 1, then the profile the codec string names.
    expect(browser.chunks()[0]?.data.readUInt8(0)).toBe(1);
    expect(kinds[1]).toBe(PREVIEW_CHUNK.key);
    const keys = kinds.flatMap((k, i) => (k === PREVIEW_CHUNK.key ? [i] : []));
    expect(keys).toEqual([1, 31]);
    browser.stop();
  }, 20_000);
});
