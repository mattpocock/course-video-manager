import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * A verify-cvm run's files never reach a real Storage Root.
 *
 * `scratch/raw-footage` was once a symlink to Matt's real `/mnt/d/raw-footage`
 * (`VERIFY_FOOTAGE_DIR`), and an agent seeding test Footage there with
 * `truncate -s` resized 51 real takes. Here a temp directory stands in for the
 * real Footage folder: the run must build its scratch as fresh real
 * directories, never link to it, and refuse to start — before creating
 * anything — when its scratch already reaches outside the run.
 */
const SCRIPTS = join(
  import.meta.dirname,
  "..",
  ".claude/skills/verify-cvm/scripts"
);

const sh = (body: string, env: Record<string, string> = {}) =>
  spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
       log() { printf '%s\\n' "$*" >&2; }
       die() { log "FAIL: $*"; exit 1; }
       OFFLINE_SERVICES_ENV=()
       CLONE_ENCODE_CAPS_ENV=()
       . "${SCRIPTS}/verify-cvm-cli.sh"
       ${body}`,
    ],
    { encoding: "utf8", env: { ...process.env, ...env } }
  );

const URL = "postgresql://postgres@localhost:5433/cvm_verify_20261013_094243_1";

let base: string;
let realFootage: string;
let run: string;
const TAKE_BYTES = 4096;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "verify-scratch-")));
  realFootage = join(base, "real-drive", "raw-footage");
  mkdirSync(realFootage, { recursive: true });
  writeFileSync(join(realFootage, "take.mkv"), Buffer.alloc(TAKE_BYTES, 1));
  run = join(base, "worktree", ".verify", "run-1");
  mkdirSync(run, { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const realFootageUntouched = () => {
  expect(readdirSync(realFootage)).toEqual(["take.mkv"]);
  expect(statSync(join(realFootage, "take.mkv")).size).toBe(TAKE_BYTES);
};

describe("verify-cvm scratch — never a real Storage Root", () => {
  it("builds raw-footage/ as a fresh, empty, real directory, even with a footage folder to link", () => {
    const r = sh(
      `clone_app_env "${run}" "${URL}"
       printf '%s\\n' "\${CLONE_APP_ENV[@]}"`,
      { VERIFY_FOOTAGE_DIR: realFootage }
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const raw = join(run, "scratch", "raw-footage");
    expect(lstatSync(raw).isSymbolicLink()).toBe(false);
    expect(lstatSync(raw).isDirectory()).toBe(true);
    expect(readdirSync(raw)).toEqual([]);
    for (const folder of [
      "finished-videos",
      "clip-mockups",
      "overlay-renders",
    ]) {
      expect(lstatSync(join(run, "scratch", folder)).isDirectory()).toBe(true);
    }
    expect(r.stdout).toContain(`STORAGE_ROOTS=${run}/scratch\n`);
    expect(r.stdout).toContain(`CVM_VERIFY_RUN_DIR=${run}\n`);
    realFootageUntouched();
  });

  it("refuses a run whose scratch/raw-footage is a symlink, and writes nothing through it", () => {
    mkdirSync(join(run, "scratch"));
    symlinkSync(realFootage, join(run, "scratch", "raw-footage"));
    const r = sh(`clone_app_env "${run}" "${URL}"`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing: .*scratch\/raw-footage is a symlink/);
    realFootageUntouched();
  });

  it("refuses a hand-made link to the real Footage anywhere in the run directory", () => {
    mkdirSync(join(run, "footage-root"));
    symlinkSync(realFootage, join(run, "footage-root", "raw-footage"));
    const r = sh(`clone_app_env "${run}" "${URL}"`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /footage-root\/raw-footage is a symlink to .*outside this run/
    );
    expect(existsSync(join(run, "scratch"))).toBe(false);
    realFootageUntouched();
  });

  it("takes VERIFY_EXTRA_STORAGE_ROOTS names inside the run (an Offline drive)", () => {
    const r = sh(
      `clone_app_env "${run}" "${URL}"
       printf '%s\\n' "\${CLONE_APP_ENV[@]}"`,
      { VERIFY_EXTRA_STORAGE_ROOTS: "gone" }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`STORAGE_ROOTS=${run}/scratch,${run}/gone\n`);
  });

  it("refuses a VERIFY_EXTRA_STORAGE_ROOTS entry on a real drive", () => {
    const r = sh(`clone_app_env "${run}" "${URL}"`, {
      VERIFY_EXTRA_STORAGE_ROOTS: join(base, "real-drive"),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/outside this run's directory/);
    realFootageUntouched();
  });

  it("refuses a symlink anywhere under scratch/", () => {
    mkdirSync(join(run, "scratch", "clip-mockups"), { recursive: true });
    symlinkSync(realFootage, join(run, "scratch", "clip-mockups", "deep"));
    const r = sh(`clone_app_env "${run}" "${URL}"`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing: .*clip-mockups\/deep is a symlink/);
    realFootageUntouched();
  });

  it("refuses a run whose scratch/ itself is a symlink, before creating anything on the far side", () => {
    const drive = join(base, "real-drive");
    symlinkSync(drive, join(run, "scratch"));
    const r = sh(`clone_app_env "${run}" "${URL}"`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing: .*scratch is a symlink/);
    expect(readdirSync(drive)).toEqual(["raw-footage"]);
    realFootageUntouched();
  });

  it.each([
    [
      "a Storage Root outside the run",
      () => `STORAGE_ROOTS=${base}/real-drive`,
    ],
    [
      "a second Storage Root outside the run",
      () => `STORAGE_ROOTS=${run}/scratch,${base}/real-drive`,
    ],
    ["a folder outside the run", () => `VIDEO_FILES_DIR=${base}/elsewhere`],
    ["a path that climbs out", () => `STORAGE_ROOTS=${run}/scratch/../..`],
  ])("refuses %s", (_name, kv) => {
    const r = sh(`assert_env_paths_contained "${run}" "${kv()}"`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing: .*outside this run's directory/);
  });

  it("refuses a Storage Folder that is a symlink under an in-run root", () => {
    mkdirSync(join(run, "scratch"));
    symlinkSync(realFootage, join(run, "scratch", "raw-footage"));
    const r = sh(
      `assert_env_paths_contained "${run}" "STORAGE_ROOTS=${run}/scratch"`
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/raw-footage is a symlink/);
    expect(existsSync(join(realFootage, "take.mkv"))).toBe(true);
  });

  it("gives a --production run the same scratch roots and real-drive guard as a clone", () => {
    const r = sh(
      `run_files_env "${run}"
       printf '%s\\n' "\${RUN_FILES_ENV[@]}"
       clone_app_env "${run}" "${URL}"
       printf 'clone:%s\\n' "\${CLONE_APP_ENV[@]}"`
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    // The app refuses any /mnt path while either is set (real-drives.ts).
    expect(r.stdout).toContain(`STORAGE_ROOTS=${run}/scratch\n`);
    expect(r.stdout).toContain(`CVM_VERIFY_RUN_DIR=${run}\n`);
    expect(r.stdout).toContain("CVM_NO_REAL_DRIVES=1\n");
    expect(r.stdout).toContain("clone:CVM_NO_REAL_DRIVES=1\n");
    // No database in the files env: a --production run keeps its own.
    expect(r.stdout.split("clone:")[0]).not.toContain("DATABASE_URL=");
  });
});
