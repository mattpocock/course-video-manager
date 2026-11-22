import { SystemError } from "@effect/platform/Error";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { offlineRootMessage } from "@/packages/storage";
import { makeTestCliOutput } from "./output";
import { renderToExitCode } from "./render";
import { readEnv } from "@/packages/env";

// Two made-up roots: nothing here touches the disk.
const ROOTS = "/tmp/cvm-render-test-d,/tmp/cvm-render-test-e";
const previous = readEnv("STORAGE_ROOTS");

beforeEach(() => {
  process.env.STORAGE_ROOTS = ROOTS;
});

afterEach(() => {
  if (previous === undefined) delete process.env.STORAGE_ROOTS;
  else process.env.STORAGE_ROOTS = previous;
});

describe("renderToExitCode, on an Offline Storage Root", () => {
  it("renders any command's raw ENODEV as the Offline message, naming the root", async () => {
    // What `fs.exists` failed with on 2026-10-27, from `cvm file add`.
    const path = "/tmp/cvm-render-test-e/video-files/lineage/writer-notes.md";
    const enodev = new SystemError({
      reason: "Unknown",
      module: "FileSystem",
      method: "access",
      pathOrDescriptor: path,
      cause: Object.assign(
        new Error(`ENODEV: no such device, access '${path}'`),
        { code: "ENODEV" }
      ),
    });
    const out = makeTestCliOutput();

    const exitCode = await Effect.runPromise(
      renderToExitCode(Effect.fail(enodev)).pipe(Effect.provide(out.layer))
    );

    expect(exitCode).toBe(4);
    expect(JSON.parse(out.stderr())).toEqual({
      _tag: "StorageRootOfflineError",
      root: "/tmp/cvm-render-test-e",
      message: offlineRootMessage("/tmp/cvm-render-test-e"),
    });
    expect(out.stderr()).not.toContain("ENODEV");
  });
});
