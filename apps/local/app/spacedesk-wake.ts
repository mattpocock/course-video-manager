import net from "node:net";
import crypto from "node:crypto";
import { after } from "@/packages/clock";

/**
 * Wakes the spacedesk virtual display (the 1080x1080 monitor a Short is
 * filmed on, ADR 0043) with no browser, no viewer window and nothing on
 * screen.
 *
 * Plain Node (`net`, `crypto`) and Promise-based, with no Effect and no `@/`
 * import, so both the app server's `SpacedeskService` and the recorder
 * service can call it.
 *
 * Background: spacedesk turns the Windows PC into a "server" that exposes a
 * virtual monitor. Something has to connect as a client to activate that
 * monitor. Normally that's the HTML5 viewer — a static page that opens a
 * WebSocket to `ws://<host>:28252`, identifies itself, and then streams the
 * desktop onto a canvas. We never want to *see* the picture; we only need the
 * display to switch on. Because the display is configured to persist, it stays
 * on after the client disconnects.
 *
 * So we reimplement just the viewer's handshake: open the WebSocket, send the
 * one identification packet the server needs to register a client and
 * activate the display, wait until the server starts streaming (which confirms
 * the display is awake), then hang up.
 *
 * Protocol (reverse-engineered from the viewer's bundled JS, spacedesk v4.8):
 * - Connect `ws://<host>:28252`, path "/". On open the client sends exactly one
 *   462-byte "IdentificationPacket"; the server replies with Visibility headers
 *   and then FrameBuffer packets (the live desktop). Seeing any frame back
 *   means the handshake was accepted and the display is active.
 * - The packet is a 128-byte little-endian header + 334-byte payload:
 *     header[0]  = 0   (Identification header type)
 *     header[4]  = 334 (bytes following the header)
 *     header[8]  = 4   (protocol version major)
 *     header[12] = 8   (protocol version minor)
 *     header[16] = 1   (client type: WebBrowser)
 *     header[24] = compression, header[32] = quality, header[44] = frameRate(i16)
 *     header[48] = 2 (custom-resolution mode), [52]/[88] = width/height,
 *                  [56]/[92] = custom width/height
 *     payload    = fixed "1111122222" magic prefix, then a UTF-16LE client name
 *                  starting at offset 78.
 *   width/height is the viewer's "client resolution", the size it asks the
 *   display to have in Extension mode; custom width/height is its "custom
 *   resolution" (for Duplication). Both are 1080x1080, the Short's square.
 *   They are a request: the size the display actually has is the one set for
 *   it on the PC (Windows Display settings), and the recorder checks that size
 *   (`recorder-service/screen-side.ts`), not this one.
 *
 * The spacedesk server binds to the PC's LAN interface, not loopback, so
 * connecting to 127.0.0.1 does NOT work: the host is the PC's fixed LAN IP.
 */

/** The PC running the spacedesk server. Its one fixed LAN address. */
export const SPACEDESK_HOST = "192.168.68.58";

/** spacedesk's default server port. `SPACEDESK_PORT` in the env overrides it. */
export const SPACEDESK_DEFAULT_PORT = 28252;

export interface SpacedeskAddress {
  host: string;
  port: number;
}

/** Where the spacedesk server is: the fixed host, and the port from the env. */
export const spacedeskAddress = (
  env: Record<string, string | undefined> = process.env
): SpacedeskAddress => ({
  host: SPACEDESK_HOST,
  port: Number(env.SPACEDESK_PORT) || SPACEDESK_DEFAULT_PORT,
});

/** The size the handshake asks the display to have: a Short's square. */
export const SPACEDESK_SIZE = { width: 1080, height: 1080 } as const;

// spacedesk protocol v4.8 packet layout.
const HEADER_LENGTH = 128;
const PAYLOAD_LENGTH = 334;
const PACKET_LENGTH = HEADER_LENGTH + PAYLOAD_LENGTH; // 462

// How long to wait for the TCP+WebSocket handshake before giving up.
const CONNECT_TIMEOUT_MS = 8000;
// After identifying, how long to wait for the server's first frame (which
// confirms the display activated) before we give up waiting and close anyway.
const ACTIVATION_TIMEOUT_MS = 4000;

/** The wake failed: the server was unreachable, timed out, or refused us. */
export class SpacedeskWakeError extends Error {
  override readonly name = "SpacedeskWakeError";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

const writeInt32LE = (u: Uint8Array, off: number, v: number): void => {
  u[off] = v & 0xff;
  u[off + 1] = (v >>> 8) & 0xff;
  u[off + 2] = (v >>> 16) & 0xff;
  u[off + 3] = (v >>> 24) & 0xff;
};

const writeInt16LE = (u: Uint8Array, off: number, v: number): void => {
  u[off] = v & 0xff;
  u[off + 1] = (v >>> 8) & 0xff;
};

/** Build the 462-byte identification packet the server expects on connect. */
const buildIdentificationPacket = (): Buffer => {
  const packet = new Uint8Array(PACKET_LENGTH);
  const header = packet.subarray(0, HEADER_LENGTH);

  writeInt32LE(header, 0, 0); // Identification header type
  writeInt32LE(header, 4, PAYLOAD_LENGTH); // bytes following header
  writeInt32LE(header, 8, 4); // version major
  writeInt32LE(header, 12, 8); // version minor
  writeInt32LE(header, 16, 1); // client type: WebBrowser
  writeInt32LE(header, 24, 3); // compression
  writeInt32LE(header, 32, 40); // quality
  writeInt16LE(header, 44, 0); // frame rate
  writeInt32LE(header, 48, 2); // custom-resolution mode
  writeInt32LE(header, 52, SPACEDESK_SIZE.width); // width
  writeInt32LE(header, 88, SPACEDESK_SIZE.height); // height
  writeInt32LE(header, 56, SPACEDESK_SIZE.width); // custom width
  writeInt32LE(header, 92, SPACEDESK_SIZE.height); // custom height

  const payload = packet.subarray(HEADER_LENGTH);
  // Fixed "1111122222" magic prefix (one byte per UTF-16LE char, low byte only).
  const magic = [0x31, 0x31, 0x31, 0x31, 0x31, 0x32, 0x32, 0x32, 0x32, 0x32];
  for (let i = 0; i < magic.length; i++) payload[i * 2] = magic[i]!;
  // Client name as UTF-16LE starting at offset 78.
  const name = "CVM on Windows";
  let cursor = 78;
  for (let i = 0; i < name.length; i++) {
    payload[cursor] = name.charCodeAt(i);
    cursor += 2;
  }

  return Buffer.from(packet);
};

/** Wrap a binary payload in a masked WebSocket frame (client frames must mask). */
const maskFrame = (payload: Buffer): Buffer => {
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  // Our packet is 462 bytes, so only the 16-bit length form is ever needed.
  const head =
    len < 126
      ? Buffer.from([0x82, 0x80 | len])
      : Buffer.from([0x82, 0x80 | 126, (len >> 8) & 0xff, len & 0xff]);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i]! ^ mask[i & 3]!;
  return Buffer.concat([head, mask, masked]);
};

/**
 * Wake the spacedesk display. Opens the WebSocket, identifies, and resolves
 * once the server starts streaming (display active) — or rejects with a
 * `SpacedeskWakeError` on timeout / connection error / refused upgrade. We do
 * the RFC 6455 upgrade by hand (Node's built-in WebSocket rejects the server's
 * handshake response) but only need enough of it to send one frame and see
 * one back.
 */
export const wakeSpacedesk = (
  address: SpacedeskAddress = spacedeskAddress()
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const { host, port } = address;
    const socket = net.connect(port, host);
    let settled = false;
    let upgraded = false;
    let buffer = Buffer.alloc(0);
    let framesSeen = 0;
    // Started once we're upgraded: if the server accepts us but never streams a
    // frame, we still succeed — the identification (which wakes the display) is
    // already sent.
    let activationTimer: (() => void) | undefined;

    const finish = (error?: SpacedeskWakeError) => {
      if (settled) return;
      settled = true;
      connectTimer();
      activationTimer?.();
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    const connectTimer = after(CONNECT_TIMEOUT_MS, () => {
      finish(
        new SpacedeskWakeError(
          `Timed out connecting to the spacedesk server at ${host}:${port}. Is spacedesk running on the PC?`,
          { cause: new Error("timeout") }
        )
      );
    });

    socket.on("connect", () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        [
          "GET / HTTP/1.1",
          `Host: ${host}:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n")
      );
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!upgraded) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const statusLine = buffer.slice(0, buffer.indexOf("\r\n")).toString();
        if (!statusLine.includes("101")) {
          finish(
            new SpacedeskWakeError(
              `spacedesk server refused the WebSocket handshake: "${statusLine}".`,
              { cause: new Error(statusLine) }
            )
          );
          return;
        }
        upgraded = true;
        buffer = buffer.slice(headerEnd + 4);
        connectTimer();
        socket.write(maskFrame(buildIdentificationPacket()));
        // Give the server a moment to start streaming as activation proof, but
        // don't fail if it doesn't — the packet is already sent.
        activationTimer = after(ACTIVATION_TIMEOUT_MS, () => finish());
      }

      // Any server frame after the handshake means the display is streaming.
      while (upgraded && buffer.length >= 2) {
        let len = buffer[1]! & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) break;
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) break;
          len = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + len) break;
        buffer = buffer.slice(offset + len);
        framesSeen++;
      }
      if (framesSeen > 0) finish();
    });

    socket.on("error", (e) =>
      finish(
        new SpacedeskWakeError(
          `Couldn't reach the spacedesk server at ${host}:${port}: ${e.message}`,
          { cause: e }
        )
      )
    );
    // Closed after the upgrade: the identification packet went out. Before
    // it, nothing was woken (spacedesk restarting, another service on the port).
    socket.on("close", () =>
      finish(
        upgraded
          ? undefined
          : new SpacedeskWakeError(
              `spacedesk closed the connection before the handshake (${host}:${port}).`,
              { cause: new Error("closed before the WebSocket upgrade") }
            )
      )
    );
  });
