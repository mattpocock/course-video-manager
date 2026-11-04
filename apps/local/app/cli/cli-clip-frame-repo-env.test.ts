import { describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { one } from "./cli-write-test-harness";
import {
  ctx,
  setupFrameTests,
  hasFfmpeg,
  footage,
  sizeOf,
} from "@/test-utils/cli-frame-harness";

// ===========================================================================
// cvm clip frame with STORAGE_ROOTS only in the repo-root `.env` (#2664)
//
// The other frame suites set STORAGE_ROOTS in the environment, so none could
// see this: on the author's machine it lives only in `.env`, which tsx does
// not load. `footage frame` found it there; `clip frame` failed on a missing
// setting. repo-env is mocked to a fake `.env` here, so the author's real one
// is never read into a test run.
// ===========================================================================

const fakeEnv = vi.hoisted(() => ({}) as Record<string, string>);

vi.mock("@/services/repo-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/repo-env")>();
  return {
    ...actual,
    repoEnvPath: () => undefined,
    resolveRepoEnvValue: (key: string) =>
      process.env[key] != null && process.env[key] !== ""
        ? process.env[key]
        : fakeEnv[key],
    loadRepoEnv: () => {
      for (const [key, value] of Object.entries(fakeEnv)) {
        if (process.env[key] == null) process.env[key] = value;
      }
    },
  };
});

setupFrameTests();

describe.skipIf(!hasFfmpeg)("cvm clip frame", () => {
  it("finds STORAGE_ROOTS in the repo .env, as footage frame does", async () => {
    const source = footage("plain.mp4", "yellow");
    const [video] = await ctx.testDb
      .insert(schema.videos)
      .values({ title: "Landscape", originalFootagePath: source })
      .returning();
    const [clip] = await ctx.testDb
      .insert(schema.clips)
      .values({
        videoId: video!.id,
        videoFilename: source,
        sourceStartTime: 0,
        sourceEndTime: 1,
        order: "a0",
        text: "hello there",
      })
      .returning();
    // THE CONDITION UNDER TEST: in the `.env`, not in the environment.
    fakeEnv.STORAGE_ROOTS = ctx.root;
    delete process.env.STORAGE_ROOTS;

    const result = await ctx.run(["clip", "frame", "--at", "0.5", clip!.id]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const { path } = one<{ path: string }>(result.stdout);
    expect(sizeOf(path)).toEqual({ width: 1920, height: 1080 });
  });
});
