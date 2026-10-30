import net from "node:net";
import zlib from "node:zlib";
import { CARD_CANVAS } from "../card-server";
import type { FakeProcess } from "./fake-windows";

/**
 * The scripted launcher's stand-ins for the Chat Highlight card server and
 * for the Live Stream reading its card feed (spec #2445: no real Chromium or
 * NVENC ever runs in a test).
 */

/** An 8-bit RGBA PNG of `w`x`h`: a card in the bottom-left, transparent around it. */
export const cardPng = (w: number, h: number) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const at = y * (w * 4 + 1) + 1 + x * 4;
      const card = x >= 48 && x < w - 48 && y >= h / 2 && y < h - 48;
      raw.set(card ? [16, 16, 17, 255] : [0, 0, 0, 0], at);
    }
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/**
 * The card server: ready at once, then a card still for each request line,
 * `quit` to exit, as `card-server.mjs` speaks. `p.written` holds every
 * request it was sent.
 */
export const playCardServer = (p: FakeProcess) => {
  const png = cardPng(CARD_CANVAS.width, CARD_CANVAS.height).toString("base64");
  const say = (line: object) => p.stdout(`${JSON.stringify(line)}\n`);
  setImmediate(() =>
    say({ type: "ready", ...CARD_CANVAS, startMs: 1, warmRenderMs: 1 })
  );
  p.onStdin = (text) => {
    for (const line of text.split("\n").filter(Boolean)) {
      if (line === "quit") return void setImmediate(() => p.exit(0));
      const { id } = JSON.parse(line) as { id: string };
      setImmediate(() =>
        say({ type: "card", id, ...CARD_CANVAS, renderMs: 1, png })
      );
    }
  };
};

/**
 * The Live Stream reading its card feed, as ffmpeg's rawvideo input does: it
 * connects to the port in its args and reads every frame, until it exits.
 * `bytes()`: how much it has read; `cut()`: the connection dropped, as a
 * card feed that died would leave it.
 */
export const readCardFeed = (p: FakeProcess, args: readonly string[]) => {
  const at = args.indexOf("rawvideo");
  const input = args.slice(at).find((a) => a.startsWith("tcp://"));
  let bytes = 0;
  if (at === -1 || !input) return { bytes: () => bytes, cut: () => {} };
  const socket = net.connect(Number(new URL(input).port), "127.0.0.1");
  socket.on("data", (d: Buffer) => (bytes += d.length));
  socket.on("error", () => {});
  void p.exited.then(() => socket.destroy());
  return { bytes: () => bytes, cut: () => void socket.destroy() };
};
