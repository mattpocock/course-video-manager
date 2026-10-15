import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FFMPEG_BUILD } from "../recorder-service/windows-devices";
import { cvmFfmpegPath } from "../recorder-service/windows-launcher";

/**
 * Builds CVM's ffmpeg.exe (apps/local/ffmpeg/build.sh, cached in
 * ~/.cache/cvm/ffmpeg) and copies it to the Windows user's
 * AppData\Local\cvm\ffmpeg\<build>\, where the recorder finds it.
 *
 *   pnpm --filter @cvm/local ffmpeg:install [--user <windows user>]
 *
 * Starts no Windows process: the build runs on Linux and the copy is a
 * file write. Restart the recorder service (pnpm dev) after.
 */

const BUILD_SH = path.join(import.meta.dirname, "../ffmpeg/build.sh");
const CACHE = path.join(os.homedir(), ".cache/cvm/ffmpeg");
const built = path.join(CACHE, FFMPEG_BUILD, "ffmpeg.exe");

execFileSync("bash", [BUILD_SH], { stdio: "inherit" });
if (!fs.existsSync(built)) throw new Error(`build did not produce ${built}`);

const USERS = "/mnt/c/Users";
const argUser = process.argv.indexOf("--user");
const candidates =
  argUser >= 0
    ? [process.argv[argUser + 1]!]
    : fs
        .readdirSync(USERS)
        .filter(
          (u) =>
            !["Public", "Default", "Default User", "All Users"].includes(u) &&
            fs.existsSync(path.join(USERS, u, "AppData/Local"))
        );
if (candidates.length !== 1) {
  throw new Error(
    `Which Windows user? Found ${candidates.join(", ") || "none"}: pass --user <name>.`
  );
}
const target = cvmFfmpegPath(path.join(USERS, candidates[0]!));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(built, target);
fs.chmodSync(target, 0o755);
console.log(`installed ${FFMPEG_BUILD}: ${target}`);
console.log("Restart the recorder service (pnpm dev) to use it.");
