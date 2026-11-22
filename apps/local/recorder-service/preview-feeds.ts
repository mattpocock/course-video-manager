import type http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { flvVideoParser } from "./flv-video";
import { PREVIEW_FEEDS, previewPath, type PreviewFeed } from "./protocol";

/**
 * THE PREVIEW FEEDS: each ffmpeg.exe that sees a picture connects to a
 * feed's TCP port and sends it. The service keeps reading, never pushing
 * back on ffmpeg, and tells whoever waits for a frame (the camera opener).
 *
 * The camera and screen previews are low-latency H.264 in FLV (#2192,
 * `previewOutput`). The service relays them to the browser as they come:
 * `GET /preview/<feed>` is one long response of preview chunks
 * (`PREVIEW_CHUNK`), the decoder's config first, then the frames since the
 * last keyframe, then each new frame the moment its last byte is in. A
 * browser that cannot keep up is never sent a backlog: once its socket holds
 * more than `MAX_BUFFERED_BYTES`, it is sent nothing more until the next
 * keyframe, so it skips ahead instead of falling behind.
 *
 * The `still` feed is not a preview: the camera preview process also sends a
 * few full-size (1280x720) JPEGs a second there, as mpjpeg, and the service
 * keeps only the latest (`latest`), for the thumbnail camera's still (`GET
 * /still`).
 */

/** Every feed the service listens on: the previews, and the camera's still. */
export type Feed = PreviewFeed | "still";
const FEEDS = [...PREVIEW_FEEDS, "still"] as const satisfies readonly Feed[];

/**
 * What a preview response is made of: one byte saying what follows, its
 * length (4 bytes, big-endian), then it.
 */
export const PREVIEW_CHUNK = {
  /** The avcC record the decoder is configured with. */
  config: 0,
  /** A keyframe, its NAL units length-prefixed (AVCC). */
  key: 1,
  /** Any other frame. */
  delta: 2,
} as const;

/** About two full-size keyframes: past this a browser is skipped to the next keyframe. */
const MAX_BUFFERED_BYTES = 2_000_000;

/** Frames kept since the last keyframe, for a browser that joins: at most a second or two. */
const MAX_GOP_FRAMES = 150;

const chunk = (kind: number, data: Buffer) => {
  const head = Buffer.alloc(5);
  head.writeUInt8(kind, 0);
  head.writeUInt32BE(data.length, 1);
  return Buffer.concat([head, data]);
};

/** Splits an mpjpeg stream into its JPEGs. */
const mpjpegParser = (onJpeg: (jpeg: Buffer) => void) => {
  let buffer = Buffer.alloc(0);
  return (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = buffer
        .subarray(0, headerEnd)
        .toString("latin1")
        .match(/Content-length:\s*(\d+)/i)?.[1];
      if (!length) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      const end = start + Number(length);
      if (buffer.length < end) return;
      onJpeg(Buffer.from(buffer.subarray(start, end)));
      buffer = buffer.subarray(end);
    }
  };
};

/** A browser watching a preview feed. */
type Watcher = { res: http.ServerResponse; skipping: boolean };

export const startPreviewFeeds = async () => {
  const frameListeners: Record<Feed, Set<() => void>> = {
    camera: new Set(),
    screen: new Set(),
    still: new Set(),
  };
  let still: { jpeg: Buffer; atMs: number } | undefined;
  /** Per preview feed: its decoder config and the chunks since its last keyframe. */
  const streams: Record<
    PreviewFeed,
    { config: Buffer | undefined; gop: Buffer[]; watchers: Set<Watcher> }
  > = {
    camera: { config: undefined, gop: [], watchers: new Set() },
    screen: { config: undefined, gop: [], watchers: new Set() },
  };
  const sockets = new Set<net.Socket>();

  const tell = (feed: Feed) => {
    for (const listener of frameListeners[feed]) listener();
  };

  const onFrame = (feed: Feed, listener: () => void) => {
    frameListeners[feed].add(listener);
    return () => void frameListeners[feed].delete(listener);
  };

  const send = (w: Watcher, data: Buffer, key: boolean) => {
    if (w.skipping && !key) return;
    if (w.res.writableLength > MAX_BUFFERED_BYTES) {
      w.skipping = true;
      return;
    }
    w.skipping = false;
    w.res.write(data);
  };

  const parserFor = (feed: Feed) => {
    if (feed === "still")
      return mpjpegParser((jpeg) => {
        still = { jpeg, atMs: Date.now() };
        tell(feed);
      });
    const stream = streams[feed];
    return flvVideoParser((video) => {
      if (video.kind === "config") {
        stream.config = chunk(PREVIEW_CHUNK.config, video.avcC);
        stream.gop = [];
        for (const w of stream.watchers) {
          w.skipping = true;
          send(w, stream.config, true);
        }
        return;
      }
      const data = chunk(
        video.key ? PREVIEW_CHUNK.key : PREVIEW_CHUNK.delta,
        video.data
      );
      if (video.key) stream.gop = [];
      if (video.key || stream.gop.length > 0) stream.gop.push(data);
      if (stream.gop.length > MAX_GOP_FRAMES) stream.gop = [];
      for (const w of stream.watchers) send(w, data, video.key);
      tell(feed);
    });
  };

  const listen = (feed: Feed) =>
    new Promise<net.Server>((resolve, reject) => {
      const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.setNoDelay(true);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        socket.on("data", parserFor(feed));
      });
      server.once("error", reject);
      // An ephemeral port, handed to each ffmpeg.exe in its arguments.
      server.listen(0, "127.0.0.1", () => resolve(server));
    });

  const servers = Object.fromEntries(
    await Promise.all(FEEDS.map(async (f) => [f, await listen(f)] as const))
  ) as Record<Feed, net.Server>;
  const portOf = (feed: Feed) => (servers[feed].address() as AddressInfo).port;

  return {
    /** The TCP port ffmpeg.exe sends a feed to. */
    port: portOf,

    /** Calls `listener` on each frame of a feed, until unsubscribed. */
    onFrame,

    /** The latest still and when it arrived (`Date.now()` ms), if any came. */
    latestStill: () => still,

    /** Serves `GET /preview/<feed>` with these CORS headers; false for any other request. */
    serve(
      req: http.IncomingMessage,
      res: http.ServerResponse,
      cors: Record<string, string>
    ) {
      const url = new URL(req.url ?? "/", "http://service");
      const feed = PREVIEW_FEEDS.find((f) => url.pathname === previewPath(f));
      if (!feed || req.method !== "GET") return false;
      const stream = streams[feed];
      res.socket?.setNoDelay(true);
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/octet-stream",
        ...cors,
      });
      // Whatever it joins on, it can decode from the next keyframe at most.
      const watcher: Watcher = { res, skipping: false };
      if (stream.config) {
        res.write(stream.config);
        for (const c of stream.gop) res.write(c);
      }
      watcher.skipping = !stream.config || stream.gop.length === 0;
      stream.watchers.add(watcher);
      res.on("close", () => stream.watchers.delete(watcher));
      return true;
    },

    async close() {
      for (const stream of Object.values(streams))
        for (const w of stream.watchers) w.res.end();
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        Object.values(servers).map(
          (s) => new Promise<void>((resolve) => s.close(() => resolve()))
        )
      );
    },
  };
};

export type PreviewFeeds = Awaited<ReturnType<typeof startPreviewFeeds>>;
