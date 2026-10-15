import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Launch, LaunchedProcess, Launcher } from "./launcher";

/**
 * The production launcher: ffmpeg.exe, nvidia-smi.exe and PowerShell on
 * Windows, started from WSL. Untested in CI by design (it is the boundary the
 * tests fake); the rig (#1992) proved each call on Matt's machine.
 */

const SYSTEM32 = "/mnt/c/Windows/System32";
const POWERSHELL = `${SYSTEM32}/WindowsPowerShell/v1.0/powershell.exe`;

/**
 * ffmpeg.exe from `winget install Gyan.FFmpeg --version 8.0.1`, found under
 * every Windows user's WinGet packages, preferring the 8.0.1 build when several
 * sit side by side. `FFMPEG_EXE` (a WSL path) overrides the search. The version
 * itself is checked by the service at start-up, not here.
 */
export const findFfmpegExe = (): string | undefined => {
  if (process.env.FFMPEG_EXE) return process.env.FFMPEG_EXE;
  const users = "/mnt/c/Users";
  if (!fs.existsSync(users)) return undefined;
  const found: string[] = [];
  for (const user of fs.readdirSync(users)) {
    const root = path.join(
      users,
      user,
      "AppData/Local/Microsoft/WinGet/Packages"
    );
    if (!fs.existsSync(root)) continue;
    for (const pkg of fs.readdirSync(root)) {
      if (!pkg.startsWith("Gyan.FFmpeg")) continue;
      for (const build of fs.readdirSync(path.join(root, pkg))) {
        const exe = path.join(root, pkg, build, "bin", "ffmpeg.exe");
        if (fs.existsSync(exe)) found.push(exe);
      }
    }
  }
  return found.find((f) => f.includes("ffmpeg-8.0.1-")) ?? found[0];
};

const toWindowsPath = (wslPath: string) =>
  execFileSync("wslpath", ["-w", wslPath], { encoding: "utf8" }).trim();

const command = (
  launch: Launch
): { file: string; args: string[]; cwd: string } => {
  switch (launch.tool) {
    case "ffmpeg": {
      const exe = findFfmpegExe();
      if (!exe) {
        throw new Error(
          "ffmpeg.exe not found. Install it on Windows with: winget install Gyan.FFmpeg --version 8.0.1"
        );
      }
      return { file: exe, args: [...launch.args], cwd: launch.cwd };
    }
    case "nvidia-smi":
      return {
        file: `${SYSTEM32}/nvidia-smi.exe`,
        args: [...launch.args],
        cwd: "/mnt/c",
      };
    case "powershell":
      return {
        file: POWERSHELL,
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          toWindowsPath(path.join(import.meta.dirname, launch.script)),
          ...launch.args,
        ],
        cwd: "/mnt/c",
      };
  }
};

/** A process that could not even be started: it "exits" at once with null. */
const failedToStart = (message: string): LaunchedProcess => {
  const stderrListeners: ((chunk: string) => void)[] = [];
  const exited = new Promise<number | null>((resolve) =>
    setImmediate(() => {
      for (const l of stderrListeners) l(`${message}\n`);
      resolve(null);
    })
  );
  return {
    onStdout: () => {},
    onStderr: (l) => void stderrListeners.push(l),
    writeStdin: () => {},
    exited,
    kill: () => {},
  };
};

export const windowsLauncher: Launcher = (launch) => {
  let cmd: ReturnType<typeof command>;
  try {
    cmd = command(launch);
  } catch (e) {
    return failedToStart(e instanceof Error ? e.message : String(e));
  }
  const child = spawn(cmd.file, cmd.args, {
    cwd: cmd.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // "close", not "exit": it comes after the last of stdout and stderr, so a
  // reader has every line before it hears the process is gone.
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
  // A write to a process that already quit must not crash the service.
  child.stdin.on("error", () => {});
  // Both pipes are always read, listened to or not: one left full blocks
  // ffmpeg on its next write, and a blocked ffmpeg never sees `q`.
  const drain = (stream: NodeJS.ReadableStream) => {
    const listeners: ((chunk: string) => void)[] = [];
    stream.on("data", (d: Buffer) => {
      const chunk = d.toString();
      for (const l of listeners) l(chunk);
    });
    return (l: (chunk: string) => void) => void listeners.push(l);
  };
  const onStdout = drain(child.stdout);
  const onStderr = drain(child.stderr);
  return {
    onStdout,
    onStderr,
    writeStdin: (text) => {
      if (child.exitCode === null) child.stdin.write(text);
    },
    exited,
    kill: () => {
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
};
