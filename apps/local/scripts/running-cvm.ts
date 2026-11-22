import net from "node:net";
import { log } from "@/packages/log";

/**
 * What of this checkout's CVM is running right now: its app server (the dev
 * or start server, on 5173) and its Sidecar (a Unix socket). The one-off
 * storage scripts (#2104) refuse to `--apply` while either answers: an app or
 * Sidecar started before the switch still runs the OLD export GC, which would
 * delete every renamed export as stale, and a new one could export or GC
 * between the rename and the migration.
 *
 * A listener that accepts a connection counts as running; anything else
 * (refused, missing socket file, timeout) does not.
 */
export const findRunningCvm = async (targets: {
  readonly appPort: number;
  readonly sidecarSocket: string;
}): Promise<string[]> => {
  const running: string[] = [];
  if (await answers({ port: targets.appPort, host: "127.0.0.1" })) {
    running.push(`the app server on port ${targets.appPort}`);
  }
  if (await answers({ path: targets.sidecarSocket })) {
    running.push(`the Sidecar on ${targets.sidecarSocket}`);
  }
  return running;
};

const answers = (to: net.NetConnectOpts): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect(to);
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

/** The app's port: 5173, where `pnpm dev` and `pnpm start` both serve it. */
export const CVM_APP_PORT = 5173;

/**
 * Exit before `--apply` when CVM is running, naming what to stop. A dry run
 * reads only, so it is allowed.
 */
export const refuseApplyWhileCvmRuns = async (targets: {
  readonly appPort: number;
  readonly sidecarSocket: string;
}): Promise<void> => {
  const running = await findRunningCvm(targets);
  if (running.length === 0) return;
  log.error(
    `\nREFUSED: --apply while CVM is running (${running.join("; ")}).\n` +
      "Stop `pnpm dev` (it runs the app and the Sidecar) and run this again. Nothing was changed."
  );
  process.exit(1);
};
