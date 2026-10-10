// Windows-side helpers. The rig runs in WSL but every capture, encode and
// measurement tool is a Windows .exe reached through interop.
import { execFileSync } from "node:child_process";
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

/** Path (WSL form) to the Windows ffmpeg.exe / ffprobe.exe from `winget install Gyan.FFmpeg`. */
export function windowsTool(name: "ffmpeg" | "ffprobe"): string {
  const override =
    process.env[name === "ffmpeg" ? "FFMPEG_EXE" : "FFPROBE_EXE"];
  if (override) return override;
  for (const root of WINGET_ROOTS()) {
    for (const pkg of fs
      .readdirSync(root)
      .filter((d) => d.startsWith("Gyan.FFmpeg"))) {
      for (const build of fs.readdirSync(path.join(root, pkg))) {
        const exe = path.join(root, pkg, build, "bin", `${name}.exe`);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  throw new Error(
    `${name}.exe not found. Install it on Windows with: winget install Gyan.FFmpeg --version 8.0.1`
  );
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

/** Force-kill (TerminateProcess, the Windows kill -9) every ffmpeg.exe whose command line contains `tag`. */
export function killWindowsFfmpeg(tag: string): number[] {
  const out = powershell(
    `Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((s) => Number(s));
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
