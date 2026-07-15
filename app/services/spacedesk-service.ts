import { Data, Effect } from "effect";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import crypto from "node:crypto";

const execAsync = promisify(exec);

/**
 * SpacedeskService wakes the spacedesk virtual display with a single click —
 * no browser, no viewer window, nothing visible on screen.
 *
 * Background: spacedesk turns the Windows PC into a "server" that exposes a
 * virtual monitor (shaped like a TikTok video). Something has to connect as a
 * client to activate that monitor. Normally that's the HTML5 viewer — a static
 * page that opens a WebSocket to `ws://<ip>:28252`, identifies itself, and then
 * streams the desktop onto a canvas. But we never want to *see* the picture; we
 * only need the display to switch on. And because the display is configured to
 * persist, it stays on after the client disconnects.
 *
 * So instead of launching the viewer, we reimplement just its handshake. This
 * service opens the WebSocket itself (server-side, from Node), sends the one
 * identification packet the server needs to register a client and activate the
 * display, waits until the server starts streaming (which confirms the display
 * is awake), then hangs up. The spacedesk viewer dependency is gone entirely.
 *
 * Protocol (reverse-engineered from the viewer's bundled JS, spacedesk v4.8):
 * - Connect `ws://<ip>:28252`, path "/". On open the client sends exactly one
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
 *                  starting at offset 78. (The exact values are cosmetic for our
 *                  purpose — the display's real shape is defined server-side.)
 *
 * The server address matters: the spacedesk server binds to the machine's LAN
 * interface, not loopback, so connecting to 127.0.0.1 does NOT work. When no
 * address is configured we auto-detect the Windows host's LAN IPv4 (the address
 * on the adapter that owns the default gateway, e.g. 192.168.x.x). This is
 * queried against Windows via PowerShell because the CVM server runs inside WSL,
 * which has its own NAT IP and cannot see the Windows LAN address directly.
 *
 * Config (all optional, via env, with sensible defaults):
 * - SPACEDESK_SERVER_IP: spacedesk server address (auto-detected LAN IP if unset).
 * - SPACEDESK_PORT:      spacedesk server port (default 28252).
 */

const DEFAULT_PORT = 28252;

// spacedesk protocol v4.8 packet layout.
const HEADER_LENGTH = 128;
const PAYLOAD_LENGTH = 334;
const PACKET_LENGTH = HEADER_LENGTH + PAYLOAD_LENGTH; // 462

// How long to wait for the TCP+WebSocket handshake before giving up.
const CONNECT_TIMEOUT_MS = 8000;
// After identifying, how long to wait for the server's first frame (which
// confirms the display activated) before we give up waiting and close anyway.
const ACTIVATION_TIMEOUT_MS = 4000;

// The IPv4 address of the Up adapter that owns the default gateway — i.e. the
// real LAN connection (Wi-Fi/Ethernet), never the WSL vEthernet NAT adapter,
// which has no default gateway.
const DETECT_IP_COMMAND =
  `powershell.exe -NoProfile -Command ` +
  `"(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' }).IPv4Address.IPAddress"`;

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export class SpacedeskError extends Data.TaggedError("SpacedeskError")<{
  cause: unknown;
  message: string;
}> {}

/** Detect the Windows host's LAN IPv4 by asking Windows over PowerShell. */
const detectServerIp = (): Effect.Effect<string, SpacedeskError> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execAsync(DETECT_IP_COMMAND);
      const ip = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => IPV4_PATTERN.test(line));
      if (!ip) {
        throw new Error("no IPv4 address with a default gateway was found");
      }
      return ip;
    },
    catch: (e) =>
      new SpacedeskError({
        cause: e,
        message: `Couldn't auto-detect the spacedesk server's LAN IP — set SPACEDESK_SERVER_IP in your .env (e.g. 192.168.x.x). ${e}`,
      }),
  });

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
  writeInt32LE(header, 52, 1920); // width
  writeInt32LE(header, 88, 1080); // height
  writeInt32LE(header, 56, 1080); // custom width
  writeInt32LE(header, 92, 1920); // custom height

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
 * Open the WebSocket, identify, and resolve once the server starts streaming
 * (display active) — or reject on timeout / connection error. We do the RFC 6455
 * upgrade by hand (Node's built-in WebSocket rejects the server's handshake
 * response) but only need enough of it to send one frame and see one back.
 */
const wakeDisplayViaSocket = (
  ip: string,
  port: number
): Effect.Effect<void, SpacedeskError> =>
  Effect.async<void, SpacedeskError>((resume) => {
    const socket = net.connect(port, ip);
    let settled = false;
    let upgraded = false;
    let buffer = Buffer.alloc(0);
    let framesSeen = 0;
    // Started once we're upgraded: if the server accepts us but never streams a
    // frame, we still succeed — the identification (which wakes the display) is
    // already sent.
    let activationTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: SpacedeskError) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(activationTimer);
      socket.destroy();
      resume(error ? Effect.fail(error) : Effect.succeed(undefined as void));
    };

    const connectTimer = setTimeout(() => {
      finish(
        new SpacedeskError({
          cause: new Error("timeout"),
          message: `Timed out connecting to the spacedesk server at ${ip}:${port}. Is spacedesk running, and is SPACEDESK_SERVER_IP correct?`,
        })
      );
    }, CONNECT_TIMEOUT_MS);

    socket.on("connect", () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        [
          "GET / HTTP/1.1",
          `Host: ${ip}:${port}`,
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
            new SpacedeskError({
              cause: new Error(statusLine),
              message: `spacedesk server refused the WebSocket handshake: "${statusLine}".`,
            })
          );
          return;
        }
        upgraded = true;
        buffer = buffer.slice(headerEnd + 4);
        clearTimeout(connectTimer);
        socket.write(maskFrame(buildIdentificationPacket()));
        // Give the server a moment to start streaming as activation proof, but
        // don't fail if it doesn't — the packet is already sent.
        activationTimer = setTimeout(() => finish(), ACTIVATION_TIMEOUT_MS);
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
        new SpacedeskError({
          cause: e,
          message: `Couldn't reach the spacedesk server at ${ip}:${port}: ${e.message}`,
        })
      )
    );
    socket.on("close", () => finish());
  });

export class SpacedeskService extends Effect.Service<SpacedeskService>()(
  "SpacedeskService",
  {
    effect: Effect.gen(function* () {
      const wakeDisplay = Effect.fn("wakeDisplay")(function* () {
        const serverIp =
          process.env.SPACEDESK_SERVER_IP || (yield* detectServerIp());
        const port = Number(process.env.SPACEDESK_PORT) || DEFAULT_PORT;
        yield* wakeDisplayViaSocket(serverIp, port);
      });

      return { wakeDisplay };
    }),
  }
) {}
