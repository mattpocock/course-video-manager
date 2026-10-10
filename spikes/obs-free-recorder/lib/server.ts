// Preview server (runs in WSL, reached from Windows Chrome via localhost).
//  - TCP :screenPort / :cameraPort  <- ffmpeg's mpjpeg preview feeds
//  - GET /feed/screen|camera        -> length-prefixed JPEG stream for the page
//  - GET /config                    -> T0, mode, layouts, marker period
//  - POST /event                    <- markers, scene switches, flashes, latency
//  - GET/POST /ghost                <-> last composite frame of the previous take
// The server never applies backpressure to ffmpeg: it always reads the socket
// and keeps only the newest frame; a slow page just skips frames.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

type Feed = "screen" | "camera";

export type ServerOptions = {
  port: number;
  previewPorts: Record<Feed, number>;
  runDir: string;
  ghostDir: string;
  config: Record<string, unknown>;
  onStopRequest: () => void;
};

const PAGE_DIR = path.join(import.meta.dirname, "..", "page");
const LAYOUTS = path.join(import.meta.dirname, "..", "layouts.json");

function portInUse(e: NodeJS.ErrnoException) {
  console.error(
    e.code === "EADDRINUSE"
      ? `Port ${(e as { port?: number }).port} is busy: is another ./rig still running?`
      : e.message
  );
  process.exit(1);
}

export function startServer(o: ServerOptions) {
  const clients: Record<Feed, Set<http.ServerResponse>> = {
    screen: new Set(),
    camera: new Set(),
  };
  const frames: Record<Feed, number> = { screen: 0, camera: 0 };
  // Arrival timing per feed (WSL monotonic clock: only durations are used).
  const timing: Record<Feed, { first: number; last: number; maxGap: number }> =
    {
      screen: { first: NaN, last: NaN, maxGap: 0 },
      camera: { first: NaN, last: NaN, maxGap: 0 },
    };
  const eventsFile = path.join(o.runDir, "events.jsonl");
  const t0 = o.config.t0Ms as number;

  const broadcast = (feed: Feed, jpeg: Buffer) => {
    frames[feed]++;
    const now = performance.now();
    const t = timing[feed];
    if (Number.isNaN(t.first)) t.first = now;
    else t.maxGap = Math.max(t.maxGap, now - t.last);
    t.last = now;
    const header = Buffer.alloc(4);
    header.writeUInt32BE(jpeg.length);
    for (const res of clients[feed]) {
      if (res.writableLength > 2 * jpeg.length) continue; // page is behind: skip, never queue
      res.write(header);
      res.write(jpeg);
    }
  };

  const tcpServers = (Object.keys(o.previewPorts) as Feed[]).map((feed) =>
    net
      .createServer((sock) => {
        let buf = Buffer.alloc(0);
        sock.on("error", () => {});
        sock.on("data", (d) => {
          buf = Buffer.concat([buf, d]);
          // mpjpeg part: --ffmpeg\r\nContent-Type: image/jpeg\r\nContent-length: N\r\n\r\n<N bytes>\r\n
          for (;;) {
            const headerEnd = buf.indexOf("\r\n\r\n");
            if (headerEnd < 0) break;
            const m = buf
              .subarray(0, headerEnd)
              .toString("latin1")
              .match(/Content-length:\s*(\d+)/i);
            if (!m) {
              buf = buf.subarray(headerEnd + 4);
              continue;
            }
            const len = Number(m[1]);
            const start = headerEnd + 4;
            if (buf.length < start + len) break;
            broadcast(feed, Buffer.from(buf.subarray(start, start + len)));
            buf = buf.subarray(start + len);
          }
        });
      })
      .on("error", portInUse)
      .listen(o.previewPorts[feed], "0.0.0.0")
  );

  const readBody = (req: http.IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (
      status: number,
      body: string | Buffer,
      type = "text/plain"
    ) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
      });
      res.end(body);
    };
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(
        200,
        fs.readFileSync(path.join(PAGE_DIR, "index.html")),
        "text/html"
      );
    }
    if (url.pathname === "/preview.js") {
      return send(
        200,
        fs.readFileSync(path.join(PAGE_DIR, "preview.js")),
        "text/javascript"
      );
    }
    if (url.pathname === "/config") {
      const layouts = JSON.parse(fs.readFileSync(LAYOUTS, "utf8"));
      return send(
        200,
        JSON.stringify({ ...o.config, layouts }),
        "application/json"
      );
    }
    const feed = url.pathname.match(/^\/feed\/(screen|camera)$/)?.[1] as
      Feed | undefined;
    if (feed) {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.socket?.setNoDelay(true);
      clients[feed].add(res);
      req.on("close", () => clients[feed].delete(res));
      return;
    }
    if (url.pathname === "/event" && req.method === "POST") {
      const ev = JSON.parse((await readBody(req)).toString());
      const line = {
        ...ev,
        fileTime:
          typeof ev.wallMs === "number" ? (ev.wallMs - t0) / 1000 : undefined,
      };
      fs.appendFileSync(eventsFile, JSON.stringify(line) + "\n");
      if (ev.type === "stop") o.onStopRequest();
      return send(204, "");
    }
    if (url.pathname === "/ghost") {
      const latest = path.join(o.ghostDir, "last-take.png");
      if (req.method === "POST") {
        const png = await readBody(req);
        fs.writeFileSync(
          path.join(o.runDir, `take-end-${Date.now()}.png`),
          png
        );
        fs.writeFileSync(latest, png);
        return send(204, "");
      }
      return fs.existsSync(latest)
        ? send(200, fs.readFileSync(latest), "image/png")
        : send(404, "");
    }
    send(404, "not found");
  });
  server.on("error", portInUse).listen(o.port, "0.0.0.0");

  return {
    frames,
    /** Per feed: frames received, first one (s after `since`), longest gap (s, including the tail up to now). */
    previewStats: (since: number, feeds: Feed[]) => {
      const now = performance.now();
      const r2 = (ms: number) => Math.round(ms / 10) / 100;
      return Object.fromEntries(
        feeds.map((f) => {
          const t = timing[f];
          const seen = !Number.isNaN(t.first);
          return [
            f,
            {
              frames: frames[f],
              firstFrameSec: seen ? r2(t.first - since) : null,
              maxGapSec: seen
                ? r2(Math.max(t.maxGap, now - t.last))
                : r2(now - since),
            },
          ];
        })
      );
    },
    close: () => {
      for (const set of Object.values(clients)) for (const r of set) r.end();
      for (const t of tcpServers) t.close();
      server.close();
      server.closeAllConnections();
    },
  };
}
