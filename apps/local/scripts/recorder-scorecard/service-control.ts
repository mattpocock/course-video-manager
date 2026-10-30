import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocket } from "ws";
import {
  previewPath,
  type PreviewFeed,
  type RecorderCommand,
  type RecorderMessage,
} from "../../recorder-service/protocol";

/**
 * Starting, talking to and killing the recorder service under test
 * (`service-child.ts`), and watching its preview feeds.
 */

const CHILD = path.join(import.meta.dirname, "service-child.ts");

export type ServiceProcess = {
  port: number;
  child: ChildProcess;
  /** Everything it printed, newest last. */
  output: () => string;
  /** SIGTERM: any take is stopped and its files closed. */
  stop: () => Promise<void>;
  /** SIGKILL: as a crash would end it. */
  kill: () => Promise<void>;
  /** Each chunk of the Live Stream process's `-progress`, as it comes. */
  onStreamProgress: (listener: (chunk: string) => void) => () => void;
};

export const startService = (o: {
  marker: string;
  stateDir: string;
  /** Where its output is also appended. */
  logFile?: string;
  /** The only place a Live Stream may push (the local sink); unset, none starts. */
  streamIngest?: string;
}) =>
  new Promise<ServiceProcess>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        CHILD,
        o.marker,
        o.stateDir,
        ...(o.streamIngest ? [o.streamIngest] : []),
      ],
      {
        cwd: path.join(import.meta.dirname, "../.."),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }
    );
    let output = "";
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    const timer = setTimeout(
      () => reject(new Error(`The service did not start:\n${output}`)),
      60_000
    );
    const onData = (d: Buffer) => {
      output = (output + d.toString()).slice(-200_000);
      if (o.logFile) fs.appendFileSync(o.logFile, d);
      const port = output.match(/SCORECARD-SERVICE-PORT (\d+)/)?.[1];
      if (port && timer) {
        clearTimeout(timer);
        resolve({
          port: Number(port),
          child,
          output: () => output,
          stop: async () => {
            child.kill("SIGTERM");
            await exited;
          },
          kill: async () => {
            child.kill("SIGKILL");
            await exited;
          },
          onStreamProgress: (listener) => {
            const on = (m: unknown) => {
              const msg = m as { type?: string; chunk?: string };
              if (msg.type === "stream-progress" && msg.chunk)
                listener(msg.chunk);
            };
            child.on("message", on);
            return () => void child.off("message", on);
          },
        });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`The service exited (${code}) before it listened:\n${output}`)
      );
    });
  });

/** `at`: `performance.now()`; `wall`: `Date.now()` (WSL), when it arrived. */
export type Received = { at: number; wall: number; message: RecorderMessage };

/** One WebSocket client of the service, as the app server is one; `at` is `performance.now()`. */
export const connect = async (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const received: Received[] = [];
  const waiters = new Set<() => void>();
  ws.on("message", (data) => {
    received.push({
      at: performance.now(),
      wall: Date.now(),
      message: JSON.parse(data.toString()) as RecorderMessage,
    });
    for (const w of waiters) w();
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  // A service killed mid-take (the crash scenario) must not take the scorecard with it.
  ws.on("error", () => {});

  /** The first message from index `from` on that `pred` accepts. */
  const waitFor = (
    pred: (m: RecorderMessage) => boolean,
    o: { from?: number; timeoutMs?: number; what?: string } = {}
  ) =>
    new Promise<Received>((resolve, reject) => {
      const look = () => {
        const hit = received.slice(o.from ?? 0).find((r) => pred(r.message));
        if (!hit) return false;
        waiters.delete(look);
        clearTimeout(timer);
        resolve(hit);
        return true;
      };
      const timer = setTimeout(() => {
        waiters.delete(look);
        reject(
          new Error(
            `Timed out waiting for ${o.what ?? "a message"}; last: ${JSON.stringify(received.slice(-3).map((r) => r.message)).slice(0, 1500)}`
          )
        );
      }, o.timeoutMs ?? 30_000);
      if (!look()) waiters.add(look);
    });

  return {
    received,
    /** Sends a command; returns the index the answer will be at or after, and when it went. */
    send: (command: RecorderCommand) => {
      const from = received.length;
      ws.send(JSON.stringify(command));
      return { from, at: performance.now(), wall: Date.now() };
    },
    waitFor,
    close: () => ws.terminate(),
  };
};
export type Client = Awaited<ReturnType<typeof connect>>;

export const isState =
  (kind: "open" | "recording" | "closed") => (m: RecorderMessage) =>
    m.type === "state" && m.state.kind === kind;

export const isLive = (m: RecorderMessage) =>
  m.type === "state" &&
  m.state.kind === "open" &&
  m.state.camera.kind === "live";

/**
 * Watches one preview feed as the browser gets it: the arrival time
 * (`performance.now()`) of each picture chunk (`PREVIEW_CHUNK`: 1 key, 2
 * delta).
 */
export const watchFeed = (port: number, feed: PreviewFeed) => {
  const arrivals: number[] = [];
  let buffer = Buffer.alloc(0);
  const req = http.get(
    { host: "127.0.0.1", port, path: previewPath(feed) },
    (res) => {
      res.on("data", (d: Buffer) => {
        const at = performance.now();
        buffer = Buffer.concat([buffer, d]);
        while (buffer.length >= 5) {
          const len = buffer.readUInt32BE(1);
          if (buffer.length < 5 + len) break;
          if (buffer[0] !== 0) arrivals.push(at);
          buffer = buffer.subarray(5 + len);
        }
      });
      res.on("error", () => {});
    }
  );
  req.on("error", () => {});
  return {
    arrivals,
    /** The longest wait between two frames inside [from, to], counting from `from`. */
    longestGap: (from: number, to: number) => {
      let last = from;
      let worst = 0;
      for (const t of arrivals) {
        if (t < from) continue;
        if (t > to) break;
        worst = Math.max(worst, t - last);
        last = t;
      }
      return Math.max(worst, to - last);
    },
    /** The first frame after `t`. */
    firstAfter: (t: number) => arrivals.find((a) => a > t),
    close: () => req.destroy(),
  };
};
export type FeedWatch = ReturnType<typeof watchFeed>;
