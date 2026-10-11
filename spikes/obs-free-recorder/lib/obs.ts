// Drives OBS for the unattended baseline: launch it, record through
// obs-websocket, close it gracefully, prove it's gone.
//
// Where OBS is: the same lookup CVM's vite.config.ts does (live-desk.ts) —
// VITE_OBS_WEBSOCKET_URL from the environment or the main checkout's .env,
// else the live desk's ws://localhost:4455, with no password (CVM's
// obs-connector calls connect(url) with none). Unlike CVM, a worktree is NOT
// sent to the dead port: this rig exists to drive Matt's real OBS.
//
// Mock mode (OBS_RIG_MOCK_DIR set): every call goes to lib/mock-obs.ts on
// OBS_RIG_MOCK_PORT instead, and "the OBS process" is that mock. The real OBS
// is never looked up, launched, contacted or closed.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM32, toWindowsPath } from "./win.ts";

const LIVE_OBS_URL = "ws://localhost:4455";
const OBS_URL_ENV_KEY = "VITE_OBS_WEBSOCKET_URL";
const OBS_EXE =
  process.env.OBS_EXE ?? "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe";
const POWERSHELL = `${SYSTEM32}/WindowsPowerShell/v1.0/powershell.exe`;

const mockDir = () => process.env.OBS_RIG_MOCK_DIR;
const mockPort = () => Number(process.env.OBS_RIG_MOCK_PORT ?? 4499);
export const isMock = () => !!mockDir();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The main checkout's .env (a worktree has none of its own). */
function mainCheckoutEnv(): string | undefined {
  try {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: import.meta.dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    ).trim();
    const env = path.join(path.dirname(common), ".env");
    if (!fs.existsSync(env)) return undefined;
    for (const line of fs.readFileSync(env, "utf8").split("\n")) {
      const m = line.match(
        new RegExp(`^\\s*${OBS_URL_ENV_KEY}\\s*=\\s*"?([^"#\\s]+)"?`)
      );
      if (m) return m[1];
    }
  } catch {
    /* no git: fall through to the live default */
  }
  return undefined;
}

/** Where obs-websocket is, and where that came from (never a secret: CVM uses no password). */
export function obsUrl(): { url: string; from: string } {
  if (isMock())
    return { url: `ws://localhost:${mockPort()}`, from: "mock-obs" };
  if (process.env[OBS_URL_ENV_KEY])
    return { url: process.env[OBS_URL_ENV_KEY]!, from: `$${OBS_URL_ENV_KEY}` };
  const fromEnv = mainCheckoutEnv();
  if (fromEnv)
    return { url: fromEnv, from: `${OBS_URL_ENV_KEY} in the CVM .env` };
  return { url: LIVE_OBS_URL, from: "CVM's live-desk default" };
}

export type ObsReply = {
  requestType: string;
  ok: boolean;
  code?: number;
  comment?: string;
  data?: Record<string, unknown>;
};

/** Sends requests over one connection (lib/obs-ws.ps1, on Windows). Throws if OBS can't be reached. */
export function obsCall(
  ...requests: { requestType: string; requestData?: Record<string, unknown> }[]
): ObsReply[] {
  const r = spawnSync(
    POWERSHELL,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      toWindowsPath(path.join(import.meta.dirname, "obs-ws.ps1")),
      "-Url",
      obsUrl().url,
      "-Requests",
      Buffer.from(JSON.stringify(requests)).toString("base64"),
    ],
    { cwd: "/mnt/c", encoding: "utf8", timeout: 60_000 }
  );
  if (r.status !== 0) {
    throw new Error(
      (r.stderr || r.error?.message || `obs-ws exited ${r.status}`)
        .replace(/\r/g, "")
        .trim()
    );
  }
  return r.stdout
    .replace(/\r/g, "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ObsReply);
}

/** One request; throws unless OBS answers ok. */
export function obsRequest(
  requestType: string,
  requestData?: Record<string, unknown>
) {
  const [r] = obsCall({ requestType, requestData });
  if (!r?.ok)
    throw new Error(
      `OBS ${requestType} failed: ${r?.code ?? "?"} ${r?.comment ?? ""}`.trim()
    );
  return r.data ?? {};
}

export function obsReachable(): boolean {
  try {
    obsCall({ requestType: "GetVersion" });
    return true;
  } catch {
    return false;
  }
}

// ---------- the process ----------

const mockPid = () => {
  const f = path.join(mockDir()!, "mock-obs.pid");
  return fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : undefined;
};
const alive = (pid?: number) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Whether OBS (obs64.exe, or the mock) is running. A process check only. */
export function obsRunning(): boolean {
  if (isMock()) return alive(mockPid());
  const out = execFileSync(
    `${SYSTEM32}/tasklist.exe`,
    ["/FI", "IMAGENAME eq obs64.exe", "/NH"],
    {
      cwd: "/mnt/c",
      encoding: "utf8",
    }
  );
  return /obs64\.exe/i.test(out);
}

function ps(command: string) {
  return execFileSync(
    POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      cwd: "/mnt/c",
      encoding: "utf8",
    }
  )
    .replace(/\r/g, "")
    .trim();
}

/** Starts OBS if it isn't running, then waits until obs-websocket answers. */
export async function launchObs(log: (s: string) => void): Promise<string> {
  if (obsRunning() && obsReachable()) return "already running";
  if (!obsRunning()) {
    if (isMock()) {
      const child = spawn(
        process.execPath,
        [
          path.join(import.meta.dirname, "mock-obs.ts"),
          "--port",
          String(mockPort()),
          "--dir",
          mockDir()!,
          ...(process.env.OBS_RIG_MOCK_STUCK ? ["--ignore-term"] : []),
        ],
        { detached: true, stdio: "ignore" }
      );
      child.unref();
    } else {
      const exe = OBS_EXE.replace(/'/g, "''");
      // --disable-shutdown-check: no "OBS didn't shut down properly" dialog to block on.
      ps(
        `Start-Process -FilePath '${exe}' -WorkingDirectory (Split-Path '${exe}') -ArgumentList '--disable-shutdown-check'`
      );
    }
    log(`launched ${isMock() ? "mock-obs" : "OBS"}`);
  }
  for (let i = 0; i < 90; i++) {
    if (obsReachable()) return "launched";
    await sleep(1000);
  }
  throw new Error(
    `OBS is running but obs-websocket at ${obsUrl().url} never answered (90 s)`
  );
}

/**
 * Stops any recording and the Virtual Camera, then closes OBS: WM_CLOSE first
 * (what clicking X does), then taskkill without /F (WM_CLOSE to every window,
 * for an OBS hidden in the tray), and only then a force-kill. Resolves with
 * how it closed; throws if it is still running after all three.
 */
export async function closeObs(log: (s: string) => void): Promise<string> {
  if (!obsRunning()) return "not running";
  try {
    const [rec, vcam] = obsCall(
      { requestType: "GetRecordStatus" },
      { requestType: "GetVirtualCamStatus" }
    );
    if (rec?.data?.outputActive) {
      log("OBS was still recording: stopping it");
      obsRequest("StopRecord");
    }
    if (vcam?.data?.outputActive) obsRequest("StopVirtualCam");
  } catch (e) {
    log(
      `obs-websocket not answering before close (${(e as Error).message}); closing anyway`
    );
  }
  const gone = async (sec: number) => {
    for (let i = 0; i < sec * 2; i++) {
      if (!obsRunning()) return true;
      await sleep(500);
    }
    return false;
  };
  const steps: [string, () => void][] = isMock()
    ? [
        [
          "WM_CLOSE (SIGTERM to mock-obs)",
          () => process.kill(mockPid()!, "SIGTERM"),
        ],
        [
          "force-kill (SIGKILL to mock-obs)",
          () => process.kill(mockPid()!, "SIGKILL"),
        ],
      ]
    : [
        [
          "WM_CLOSE (CloseMainWindow)",
          () =>
            ps(
              "Get-Process obs64 -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }"
            ),
        ],
        [
          "taskkill without /F (WM_CLOSE to every window)",
          () => ps("taskkill.exe /IM obs64.exe 2>&1 | Out-Null"),
        ],
        [
          "force-kill (last resort)",
          () =>
            ps("Stop-Process -Name obs64 -Force -ErrorAction SilentlyContinue"),
        ],
      ];
  for (const [how, act] of steps) {
    try {
      act();
    } catch {
      /* the next check decides */
    }
    if (await gone(how.startsWith("force") ? 10 : 20)) {
      if (isMock())
        fs.rmSync(path.join(mockDir()!, "mock-obs.pid"), { force: true });
      return how;
    }
    log(`OBS still running after ${how}`);
  }
  throw new Error(
    "OBS is still running after WM_CLOSE, taskkill and a force-kill"
  );
}
