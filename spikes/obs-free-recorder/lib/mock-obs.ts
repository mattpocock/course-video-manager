// A stand-in for OBS for dry runs and tests: an obs-websocket v5 server (no
// auth, like Matt's OBS as CVM uses it) plus a process that closes on SIGTERM,
// the way OBS closes on WM_CLOSE. It never touches the real OBS: it refuses
// port 4455.
//
//   node lib/mock-obs.ts --port 4499 --dir <folder> [--ignore-term]
//
// <folder> gets mock-obs.pid, mock-obs.log (one line per request) and the
// "recording" files. StopRecord returns the file's Windows path, as OBS does.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4499" },
    dir: { type: "string" },
    "ignore-term": { type: "boolean", default: false },
  },
});
const port = Number(values.port);
if (port === 4455)
  throw new Error("mock-obs refuses 4455: that is the real OBS");
const dir = values.dir!;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "mock-obs.pid"), String(process.pid));
const logFile = path.join(dir, "mock-obs.log");
const log = (s: string) =>
  fs.appendFileSync(logFile, `${new Date().toISOString()} ${s}\n`);

const state = {
  scene: "Camera",
  profile: "Landscape Recording",
  vcam: false,
  recording: undefined as undefined | { file: string; timer: NodeJS.Timeout },
};

function respond(type: string, data: Record<string, unknown>) {
  const ok = (responseData?: unknown) => ({
    requestStatus: { result: true, code: 100 },
    responseData,
  });
  const fail = (code: number, comment: string) => ({
    requestStatus: { result: false, code, comment },
  });
  switch (type) {
    case "GetVersion":
      return ok({ obsVersion: "mock", obsWebSocketVersion: "5.mock" });
    case "GetSceneList":
      return ok({
        currentProgramSceneName: state.scene,
        scenes: ["Camera", "Code", "No Face"].map((sceneName) => ({
          sceneName,
        })),
      });
    case "SetCurrentProgramScene":
      state.scene = String(data.sceneName);
      return ok();
    case "GetProfileList":
      return ok({
        currentProfileName: state.profile,
        profiles: ["Landscape Recording", "TikTok"],
      });
    case "SetCurrentProfile":
      state.profile = String(data.profileName);
      return ok();
    case "GetVirtualCamStatus":
      return ok({ outputActive: state.vcam });
    case "StartVirtualCam":
      if (state.vcam) return fail(500, "already active");
      state.vcam = true;
      return ok();
    case "StopVirtualCam":
      if (!state.vcam) return fail(501, "not active");
      state.vcam = false;
      return ok();
    case "GetRecordStatus":
      return ok({ outputActive: !!state.recording });
    case "StartRecord": {
      if (state.recording) return fail(500, "already active");
      const file = path.join(dir, `mock-obs-${Date.now()}.mkv`);
      fs.writeFileSync(file, "");
      // Grows while "recording", like a real file.
      const timer = setInterval(
        () => fs.appendFileSync(file, "x".repeat(1024)),
        200
      );
      state.recording = { file, timer };
      return ok();
    }
    case "StopRecord": {
      if (!state.recording) return fail(501, "not active");
      clearInterval(state.recording.timer);
      const outputPath = execFileSync("wslpath", ["-w", state.recording.file], {
        encoding: "utf8",
      }).trim();
      state.recording = undefined;
      return ok({ outputPath });
    }
    default:
      return fail(204, `mock-obs: unknown request ${type}`);
  }
}

// ---- just enough RFC 6455 for one text message at a time ----
function frame(text: string) {
  const body = Buffer.from(text);
  const len = body.length;
  const head =
    len < 126
      ? Buffer.from([0x81, len])
      : len < 65536
        ? Buffer.from([0x81, 126, len >> 8, len & 255])
        : (() => {
            const b = Buffer.alloc(10);
            b[0] = 0x81;
            b[1] = 127;
            b.writeBigUInt64BE(BigInt(len), 2);
            return b;
          })();
  return Buffer.concat([head, body]);
}

function onSocket(sock: Duplex) {
  let buf = Buffer.alloc(0);
  const send = (msg: unknown) => sock.write(frame(JSON.stringify(msg)));
  send({ op: 0, d: { obsWebSocketVersion: "5.mock", rpcVersion: 1 } });
  sock.on("error", () => {});
  sock.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0]! & 0x0f;
      let len = buf[1]! & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const masked = (buf[1]! & 0x80) !== 0;
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked)
        for (let i = 0; i < len; i++) payload[i]! ^= buf[maskOff + (i % 4)]!;
      buf = buf.subarray(off + len);
      if (opcode === 8) {
        sock.end(Buffer.from([0x88, 0]));
        return;
      }
      if (opcode !== 1) continue;
      const msg = JSON.parse(payload.toString());
      if (msg.op === 1) {
        log("Identify");
        send({ op: 2, d: { negotiatedRpcVersion: 1 } });
      } else if (msg.op === 6) {
        const { requestType, requestId, requestData } = msg.d;
        const r = respond(requestType, requestData ?? {});
        log(
          `${requestType} ${JSON.stringify(requestData ?? {})} -> ${r.requestStatus.result ? "ok" : `fail ${r.requestStatus.code}`}`
        );
        send({ op: 7, d: { requestType, requestId, ...r } });
      }
    }
  });
}

const server = http.createServer((_req, res) => {
  res.writeHead(426);
  res.end();
});
server.on("upgrade", (req, sock) => {
  const accept = crypto
    .createHash("sha1")
    .update(
      `${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
    )
    .digest("base64");
  sock.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  onSocket(sock);
});
server.listen(port, "0.0.0.0", () => log(`listening on ${port}`));

process.on("SIGTERM", () => {
  if (values["ignore-term"]) {
    log("SIGTERM ignored (stuck-OBS test)");
    return;
  }
  log("SIGTERM: closing gracefully");
  fs.rmSync(path.join(dir, "mock-obs.pid"), { force: true });
  process.exit(0);
});
