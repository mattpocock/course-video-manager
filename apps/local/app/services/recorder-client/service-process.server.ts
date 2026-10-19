import { spawn } from "node:child_process";
import path from "node:path";
import { RECORDER_SERVICE_PORT } from "recorder-service/protocol";
import { recorderBusy, recorderHealth } from "recorder-service/health";
import { installLocationRepoRoot } from "@/services/repo-env";
import type {
  RecorderServiceLauncher,
  RunningRecorderService,
} from "./service-on-demand";

/**
 * Matt's recorder service as the app server's child (ADR 0053): started on
 * demand (`service-on-demand.ts`), only by the app server whose recorder
 * client gets the real service (`recorder-service-url.ts`, #2292), so a
 * worktree's, an agent's or a verify-cvm clone's server never starts one.
 *
 * As under ADR 0035, it runs in a process group of its own, out of reach of
 * turbo's SIGKILL, and stops cleanly on SIGTERM or when its IPC channel to
 * the app server closes: it never outlives `pnpm dev` / `pnpm start` by more
 * than closing a take's files.
 */

const serviceDir = () => {
  const root = installLocationRepoRoot();
  if (!root) throw new Error("no repository root above the app server");
  return path.join(root, "apps/local/recorder-service");
};

const startProcess = (): RunningRecorderService => {
  const cwd = serviceDir();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.join(cwd, "service-process.ts")],
    {
      detached: true,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      cwd,
      env: process.env,
    }
  );
  console.log(`recorder service: started on demand (pid ${child.pid}).`);
  const exited = new Promise<void>((resolve) => {
    child.on("error", (error) => {
      console.error("recorder service: would not start", error);
      resolve();
    });
    child.on("exit", (code, signal) => {
      console.log(
        `recorder service: exited (${signal ?? `code ${code}`}). An editor opening starts it again.`
      );
      resolve();
    });
  });
  return { stop: () => void child.kill("SIGTERM"), exited };
};

export const recorderServiceProcess: RecorderServiceLauncher = {
  start: async () => {
    const health = await recorderHealth(RECORDER_SERVICE_PORT);
    if (health === "nothing") return startProcess();
    console.log(
      health === "something-else"
        ? `recorder service: not started, something else answers on port ${RECORDER_SERVICE_PORT}.`
        : `recorder service: one is already running (pid ${health.pid}); using it.`
    );
    return undefined;
  },
  busy: async () => recorderBusy(await recorderHealth(RECORDER_SERVICE_PORT)),
};
