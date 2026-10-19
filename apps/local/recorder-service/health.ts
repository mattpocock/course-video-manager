import http from "node:http";
import type { RecorderState } from "./protocol";

/** What answers on the recorder service's port, by its `/health`. */
export type RecorderHealth =
  | {
      service: "recorder";
      pid: number;
      state?: RecorderState;
      /** A stopped take is still closing its files. */
      takesClosing?: boolean;
    }
  | "nothing"
  | "something-else";

/** The service's answer to `/health`: what {@link recorderHealth} reads. */
export const serveHealth = (
  res: http.ServerResponse,
  state: RecorderState,
  takesClosing: boolean
) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      service: "recorder",
      pid: process.pid,
      state,
      takesClosing,
    })
  );
};

/** Asks `127.0.0.1:<port>/health`. Never rejects. */
export const recorderHealth = (port: number) =>
  new Promise<RecorderHealth>((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: 2000 },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body) as {
              service?: string;
              pid?: number;
              state?: RecorderState;
              takesClosing?: boolean;
            };
            resolve(
              parsed.service === "recorder"
                ? {
                    service: "recorder",
                    pid: parsed.pid ?? 0,
                    state: parsed.state,
                    takesClosing: parsed.takesClosing,
                  }
                : "something-else"
            );
          } catch {
            resolve("something-else");
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", (e: NodeJS.ErrnoException) =>
      resolve(e.code === "ECONNREFUSED" ? "nothing" : "something-else")
    );
  });

/**
 * Whether the service must not be stopped now: it is recording, or a take
 * is still closing its files. One that does not answer is not: a stop
 * closes any take's files first all the same (`stopCleanlyOn`).
 */
export const recorderBusy = (health: RecorderHealth): boolean =>
  typeof health === "object" &&
  (health.state?.kind === "recording" || health.takesClosing === true);
