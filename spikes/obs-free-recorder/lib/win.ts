// Windows-side helpers. The rig runs in WSL but every capture, encode and
// measurement tool is a Windows .exe reached through interop.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WINGET_ROOTS = () => {
  const users = "/mnt/c/Users";
  if (!fs.existsSync(users)) return [];
  return fs
    .readdirSync(users)
    .map((u) => path.join(users, u, "AppData/Local/Microsoft/WinGet/Packages"))
    .filter((p) => fs.existsSync(p));
};

/**
 * The only ffmpeg the rig runs on. 8.1 and 9.x need NVIDIA driver 610+ for
 * NVENC (this machine has 591.74), and every number in the spike was measured
 * on 8.0.1, so a different build fails loudly instead of quietly changing the
 * results. `./rig … --any-ffmpeg` overrides it (allowAnyFfmpeg).
 */
export const FFMPEG_VERSION = "8.0.1";

const checked = new Map<string, string>();
let anyFfmpeg = false;
/** Skip the version check (the --any-ffmpeg flag). */
export const allowAnyFfmpeg = () => {
  anyFfmpeg = true;
};

function assertVersion(exe: string, name: string) {
  if (checked.has(exe) || anyFfmpeg) return;
  const out = execFileSync(exe, ["-hide_banner", "-version"], {
    cwd: "/mnt/c",
    encoding: "utf8",
  });
  const version = out.match(/version (\S+)/)?.[1] ?? "unknown";
  if (!version.startsWith(`${FFMPEG_VERSION}-`) && version !== FFMPEG_VERSION) {
    throw new Error(
      `${name}.exe is ${version}, but the rig needs ${FFMPEG_VERSION} (newer builds need NVIDIA driver 610+ for NVENC). ` +
        `Install it with: winget install Gyan.FFmpeg --version ${FFMPEG_VERSION}, then winget pin add Gyan.FFmpeg --version ${FFMPEG_VERSION}. ` +
        "--any-ffmpeg skips this check."
    );
  }
  checked.set(exe, version);
}

/** Path (WSL form) to the Windows ffmpeg.exe / ffprobe.exe from `winget install Gyan.FFmpeg --version 8.0.1`. */
export function windowsTool(name: "ffmpeg" | "ffprobe"): string {
  const override =
    process.env[name === "ffmpeg" ? "FFMPEG_EXE" : "FFPROBE_EXE"];
  if (override) {
    assertVersion(override, name);
    return override;
  }
  const found: string[] = [];
  for (const root of WINGET_ROOTS()) {
    for (const pkg of fs
      .readdirSync(root)
      .filter((d) => d.startsWith("Gyan.FFmpeg"))) {
      for (const build of fs.readdirSync(path.join(root, pkg))) {
        const exe = path.join(root, pkg, build, "bin", `${name}.exe`);
        if (fs.existsSync(exe)) found.push(exe);
      }
    }
  }
  // Prefer the pinned build when several are installed side by side.
  const exe =
    found.find((f) => f.includes(`ffmpeg-${FFMPEG_VERSION}-`)) ?? found[0];
  if (!exe) {
    throw new Error(
      `${name}.exe not found. Install it on Windows with: winget install Gyan.FFmpeg --version ${FFMPEG_VERSION}`
    );
  }
  assertVersion(exe, name);
  return exe;
}

export const SYSTEM32 = "/mnt/c/Windows/System32";

export function toWindowsPath(p: string): string {
  return execFileSync("wslpath", ["-w", p], { encoding: "utf8" }).trim();
}

function powershell(command: string): string {
  return execFileSync(
    `${SYSTEM32}/WindowsPowerShell/v1.0/powershell.exe`,
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", cwd: "/mnt/c" }
  )
    .replace(/\r/g, "")
    .trim();
}

/**
 * Unix-epoch milliseconds from the Windows clock. This is the clock ffmpeg's
 * -use_wallclock_as_timestamps and Chrome's Date.now() both read, so it is the
 * rig's single shared clock. WSL's own clock can drift from it, so never use
 * Date.now() in WSL for anything that is compared with file time.
 */
export function windowsNowMs(): number {
  return Number(
    powershell("[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()")
  );
}

export type Killed = {
  pid: number;
  role: "screen" | "camera";
  killedAtMs: number;
};

/**
 * Force-kill (TerminateProcess, the Windows kill -9) every ffmpeg.exe whose
 * command line contains `tag`. Each process's kill time is read on Windows
 * right before its Stop-Process, not before PowerShell starts (~0.4 s earlier).
 */
export function killWindowsFfmpeg(tag: string): Killed[] {
  const out = powershell(
    `$ps = @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' }); ` +
      `foreach ($p in $ps) { $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); Stop-Process -Id $p.ProcessId -Force; ` +
      `$role = if ($p.CommandLine -like '*screen.mkv*') { 'screen' } else { 'camera' }; "$($p.ProcessId) $role $t" }`
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [pid, role, ms] = line.trim().split(" ");
      return {
        pid: Number(pid),
        role: role as Killed["role"],
        killedAtMs: Number(ms),
      };
    });
}

/**
 * The Windows clock, readable from WSL at any moment without spawning
 * PowerShell (0.5 s each). A PowerShell loop prints UtcNow every 20 ms; now()
 * is the latest tick plus the (WSL-timed, so ~4% off) few ms since it arrived.
 */
export function startWindowsClock() {
  const child: ChildProcess = spawn(
    `${SYSTEM32}/WindowsPowerShell/v1.0/powershell.exe`,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "while ($true) { [Console]::Out.WriteLine([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 20 }",
    ],
    { cwd: "/mnt/c", stdio: ["ignore", "pipe", "ignore"] }
  );
  process.once("exit", () => child.exitCode === null && child.kill());
  let lastWin = NaN;
  let lastAt = 0;
  let buf = "";
  const ready = new Promise<void>((resolve) => {
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop()!;
      const v = Number(lines.filter(Boolean).at(-1));
      if (Number.isFinite(v) && v > 0) {
        lastWin = v;
        lastAt = performance.now();
        resolve();
      }
    });
  });
  return {
    ready,
    now: () => Math.round(lastWin + (performance.now() - lastAt)),
    stop: () => child.kill(),
  };
}

export function windowsFileCreatedMs(wslPath: string): number {
  const win = toWindowsPath(wslPath).replace(/'/g, "''");
  return Number(
    powershell(
      `[DateTimeOffset]::new((Get-Item -LiteralPath '${win}').CreationTimeUtc).ToUnixTimeMilliseconds()`
    )
  );
}

export function openInWindowsBrowser(url: string): void {
  execFileSync(`${SYSTEM32}/cmd.exe`, ["/c", "start", "", url], {
    cwd: "/mnt/c",
  });
}

export type DshowDevice = {
  name: string;
  kind: "video" | "audio";
  alt?: string;
};

/**
 * Lists DirectShow devices. Enumerating does instantiate each capture filter,
 * so only call this when OBS is closed (the record/crash modes, never selftest).
 */
export function listDshowDevices(): DshowDevice[] {
  let text = "";
  try {
    execFileSync(
      windowsTool("ffmpeg"),
      ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch (e) {
    text = String((e as { stderr?: string }).stderr ?? "");
  }
  const devices: DshowDevice[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const m = line.match(/\] "(.+)" \((video|audio)/);
    if (m) devices.push({ name: m[1]!, kind: m[2] as "video" | "audio" });
    const alt = line.match(/Alternative name "(.+)"/);
    if (alt && devices.length) devices[devices.length - 1]!.alt = alt[1]!;
  }
  return devices;
}
