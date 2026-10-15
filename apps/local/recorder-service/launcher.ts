/**
 * THE PROCESS LAUNCHER: the recorder service's one way to start a process,
 * and so the one seam its tests fake (`recorder-service.test.ts` scripts a
 * fake ffmpeg.exe here). Everything the service runs is a Windows .exe reached
 * through WSL interop; the production half is `windows-launcher.ts`.
 */

export type PowerShellScript =
  | "screens.ps1"
  | "timer-resolution.ps1"
  | "stop-recorders.ps1"
  | "load-sampler.ps1";

export type Launch =
  /** ffmpeg.exe. `cwd` is a WSL path Windows can also see (`/mnt/…`). */
  | { tool: "ffmpeg"; args: readonly string[]; cwd: string }
  | { tool: "nvidia-smi"; args: readonly string[] }
  /** One of this folder's PowerShell scripts, with its parameters. */
  | { tool: "powershell"; script: PowerShellScript; args: readonly string[] };

export interface LaunchedProcess {
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  writeStdin(text: string): void;
  /**
   * The exit code, once every line of stdout and stderr has been delivered;
   * null when killed by a signal or never started.
   */
  readonly exited: Promise<number | null>;
  kill(): void;
}

export type Launcher = (launch: Launch) => LaunchedProcess;

/** Everything a short-lived process printed, once it has exited. */
export const runToEnd = async (
  process: LaunchedProcess
): Promise<{ code: number | null; stdout: string; stderr: string }> => {
  let stdout = "";
  let stderr = "";
  process.onStdout((chunk) => (stdout += chunk));
  process.onStderr((chunk) => (stderr += chunk));
  const code = await process.exited;
  return { code, stdout, stderr };
};

/** Calls `listener` once per complete line (CRLF or LF) of a chunked stream. */
export const lineSplitter = (listener: (line: string) => void) => {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n|\r/);
    buffer = lines.pop() ?? "";
    for (const line of lines) listener(line);
  };
};
