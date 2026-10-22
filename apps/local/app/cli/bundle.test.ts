import { afterAll, beforeAll, describe, expect, it } from "vitest";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import { buildBundle, isBundleFresh, loadCli } from "./bundle.mjs";

// ===========================================================================
// `cvm` runs from an esbuild bundle of main.ts on plain Node. The bundle must
// never be run once the sources it was built from have changed: that is what
// lets it live in node_modules/.cache with no build step to remember.
// ===========================================================================

let cacheDir: string;

beforeAll(async () => {
  cacheDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "cvm-cli-"));
  await buildBundle(cacheDir);
}, 60_000);

afterAll(() => {
  nodeFs.rmSync(cacheDir, { recursive: true, force: true });
});

describe("the cvm bundle", () => {
  it("is fresh straight after it is built, and exposes runCli", async () => {
    expect(await isBundleFresh(cacheDir)).toBe(true);
    const cli = await loadCli(cacheDir);
    expect(typeof cli.runCli).toBe("function");
  });

  it("is stale once a source file it was built from changes", async () => {
    const source = nodePath.join(import.meta.dirname, "index.ts");
    const { atime, mtime } = nodeFs.statSync(source);
    try {
      nodeFs.utimesSync(source, atime, new Date(mtime.getTime() + 1000));
      expect(await isBundleFresh(cacheDir)).toBe(false);
    } finally {
      nodeFs.utimesSync(source, atime, mtime);
    }
  });

  it("is stale when there is no bundle at all", async () => {
    const empty = nodeFs.mkdtempSync(
      nodePath.join(nodeOs.tmpdir(), "cvm-cli-")
    );
    try {
      expect(await isBundleFresh(empty)).toBe(false);
    } finally {
      nodeFs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
