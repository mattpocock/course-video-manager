import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `scripts/is-filming.sh` reads the recorder's log, and verify-cvm's verbs
 * that start the server or drive the app wait on it (#2387). Agents broke the
 * no-verifying-while-filming rule by reading the log once and carrying on, so
 * the harness checks before every step instead.
 */
const REPO = join(import.meta.dirname, "..");
const IS_FILMING = join(REPO, "scripts/is-filming.sh");
const VERIFY_SH = join(REPO, ".claude/skills/verify-cvm/scripts/verify.sh");

const root = mkdtempSync(join(tmpdir(), "is-filming-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const LISTENING =
  "2026-10-27T11:22:58.879Z recorder service listening on ws://127.0.0.1:5177 (pid 1)";
const STOPPING = "2026-10-27T11:44:21.825Z SIGTERM: stopping";
const STOPPED = "2026-10-27T11:44:21.827Z stopped cleanly";

const filming = (lines: string[] | null) => {
  const log = join(root, `${Math.random()}.log`);
  if (lines) writeFileSync(log, lines.join("\n") + "\n");
  return spawnSync(IS_FILMING, [], {
    env: { ...process.env, CVM_RECORDER_LOG: log },
  }).status;
};

const RECORDING = "2026-10-27T11:30:00.000Z takes: recording";
const NONE = "2026-10-27T11:31:00.000Z takes: none";

describe("scripts/is-filming.sh", () => {
  it("says filming (0) only while the running service's last takes line is recording", () => {
    // The app merely open: the service is up, no take.
    expect(filming([LISTENING, NONE])).toBe(1);
    expect(filming([LISTENING, NONE, RECORDING])).toBe(0);
    // Stop says none only once the take's files are closed.
    expect(filming([LISTENING, NONE, RECORDING, NONE])).toBe(1);
    // A service that died mid-take, started again: only its own run counts.
    expect(filming([LISTENING, NONE, RECORDING, LISTENING, NONE])).toBe(1);
    // Died mid-take and not started again: it may still be writing.
    expect(filming([LISTENING, NONE, RECORDING])).toBe(0);
    expect(filming([LISTENING, RECORDING, STOPPING, STOPPED])).toBe(1);
    expect(filming([])).toBe(1);
    expect(filming(null)).toBe(1);
  });

  it("says filming (0) for a running service that never logs takes (older code)", () => {
    expect(filming([LISTENING])).toBe(0);
    expect(filming([LISTENING, NONE, STOPPING, STOPPED, LISTENING])).toBe(0);
    expect(filming([LISTENING, STOPPING, STOPPED])).toBe(1);
  });
});

describe("verify.sh while Matt is filming", () => {
  it("pauses a gated verb, then carries on by itself once he stops", async () => {
    const checkout = join(root, "checkout");
    execFileSync("git", ["init", "-q", checkout]);
    const log = join(root, "recorder-service.log");
    writeFileSync(log, `${LISTENING}\n${NONE}\n${RECORDING}\n`);

    const child = spawn("bash", [VERIFY_SH, "launch", "--production"], {
      cwd: checkout,
      env: {
        ...process.env,
        CVM_RECORDER_LOG: log,
        VERIFY_FILMING_POLL_SECONDS: "0.2",
      },
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const closed = new Promise<void>((resolve) =>
      child.on("close", () => resolve())
    );

    await new Promise((r) => setTimeout(r, 1000));
    expect(child.exitCode).toBeNull();
    expect(stderr).toContain("PAUSED: Matt is filming");
    expect(stderr).not.toContain("RESUMED");

    appendFileSync(log, `${STOPPING}\n${STOPPED}\n`);
    await closed;
    expect(stderr).toContain("RESUMED: Matt has stopped filming");
  });
});
