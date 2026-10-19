import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { idleLauncher, reasonsToRefuse } from "./windows-guard";

const ffmpegExe =
  "/init /mnt/c/Users/me/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg/bin/ffmpeg.exe";

describe("the Windows guard", () => {
  it("lets Windows processes start under `pnpm dev` / `pnpm start` once the recorder service has idled out (ADR 0053)", () => {
    expect(
      reasonsToRefuse({
        linux: [
          "node /repo/node_modules/.bin/turbo run start --filter=!@cvm/overlay-renderer",
          "node --env-file=../../.env node_modules/@react-router/serve/bin.cjs ./build/server/index.js",
          "node /repo/apps/local/node_modules/.bin/react-router dev",
          "node /repo/apps/local/node_modules/.bin/tsx sidecar/run-sidecar.ts",
          "node /repo/apps/local/node_modules/.bin/tsx stream-deck-forwarder/run-stream-deck-forwarder.ts",
        ],
      })
    ).toEqual([]);
  });

  it("refuses while the recorder service runs", () => {
    expect(
      reasonsToRefuse({
        linux: [
          "node --import tsx /repo/apps/local/recorder-service/service-process.ts",
        ],
      })
    ).toHaveLength(1);
    expect(
      reasonsToRefuse({
        linux: [
          "/usr/bin/node --import tsx /repo/apps/local/recorder-service/service-process.ts",
        ],
      })
    ).toHaveLength(1);
  });

  it("refuses while a recorder ffmpeg.exe runs, even with the service gone", () => {
    expect(
      reasonsToRefuse({
        linux: [
          `${ffmpegExe} -i tcp://127.0.0.1:5000 -metadata comment=cvm-recorder-1234 camera.mkv`,
        ],
      })
    ).toHaveLength(1);
  });

  it("refuses while OBS runs", () => {
    expect(
      reasonsToRefuse({ linux: [], windows: ["explorer.exe", "OBS64.EXE"] })
    ).toEqual(["OBS is running (OBS64.EXE)."]);
  });

  it("allows another harness's ffmpeg.exe, and anything else", () => {
    expect(
      reasonsToRefuse({
        linux: [
          `${ffmpegExe} -f lavfi -i testsrc out.mkv`,
          "node vitest run recorder-service/recording-session.test.ts",
        ],
        windows: ["explorer.exe", "ffmpeg.exe", "Code.exe"],
      })
    ).toEqual([]);
  });
});

describe("the idle launcher", () => {
  // Windows writes the compiled exe through \\wsl$ as 0644; interop then
  // refuses to spawn it (EACCES).
  it("hands back an executable file, freshly built or cached", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "idle-launcher-"));
    let builds = 0;
    const build = (_src: string, exe: string) => {
      builds++;
      fs.writeFileSync(exe, "MZ", { mode: 0o644 });
    };
    const isExecutable = (f: string) => {
      try {
        fs.accessSync(f, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    };

    const built = idleLauncher({ dir, build });
    expect(isExecutable(built)).toBe(true);

    fs.chmodSync(built, 0o644);
    expect(idleLauncher({ dir, build })).toBe(built);
    expect(isExecutable(built)).toBe(true);
    expect(builds).toBe(1);
  });
});
