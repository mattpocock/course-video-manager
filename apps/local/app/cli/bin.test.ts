import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const runLauncherThroughSlowPipe = async (launcher: string) => {
  const child = spawn(process.execPath, [launcher], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdout.pause();

  const closed = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  // Keep the pipe blocked until the launcher has attempted its entire write.
  await new Promise((resolve) => setTimeout(resolve, 100));
  child.stdout.resume();

  const exitCode = await closed;

  return {
    exitCode,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr).toString(),
  };
};

describe("the cvm bin launcher", () => {
  it("lets stdout drain before exiting through a slow pipe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cvm-bin-"));
    temporaryDirectories.push(directory);

    const binPath = fileURLToPath(new URL("./bin.mjs", import.meta.url));
    const source = await readFile(binPath, "utf8");
    const byteCount = 4 * 1024 * 1024;
    const fixture = source.replace(
      /const \{ tsImport \}[\s\S]*?const \{ runCli \} = await tsImport\([^;]+;/,
      `const runCli = async () => { process.stdout.write("x".repeat(${byteCount})); return 0; };`
    );
    expect(fixture).not.toBe(source);

    const launcher = join(directory, "bin.mjs");
    await writeFile(launcher, fixture);

    const result = await runLauncherThroughSlowPipe(launcher);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toHaveLength(byteCount);
    expect(result.stdout.every((byte) => byte === 120)).toBe(true);
  });
});
