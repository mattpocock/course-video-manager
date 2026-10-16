import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageRoots } from "../index";
import {
  findStoragePath,
  findStoragePathSync,
  realDriveReached,
  realDrivesForbidden,
  resolveStoragePath,
} from "../server";

/**
 * An agent's server never reads Matt's real drives (/mnt). A verify-cvm run
 * once opened a Video whose Clips stored absolute /mnt/d/raw-footage paths:
 * under the run's scratch root they were "under no root", used as stored,
 * and ffmpeg decoded stills from real Footage while Matt recorded.
 *
 * Every /mnt path here is fake and never exists: the guard must refuse it
 * without touching the filesystem there at all.
 */

const MATT = { DATABASE_URL: "postgresql://postgres@localhost:5432/cvm" };

describe("realDrivesForbidden — whose process is it", () => {
  it("is false for Matt's own pnpm dev", () => {
    expect(realDrivesForbidden(MATT)).toBe(false);
    expect(realDrivesForbidden({})).toBe(false);
  });

  it("is true on a verify run, a cvm_verify_* database, or CVM_NO_REAL_DRIVES=1", () => {
    expect(realDrivesForbidden({ CVM_VERIFY_RUN_DIR: "/w/.verify/r" })).toBe(
      true
    );
    expect(
      realDrivesForbidden({
        DATABASE_URL:
          "postgresql://postgres@localhost:5433/cvm_verify_20261016_1",
      })
    ).toBe(true);
    expect(
      realDrivesForbidden({
        DATABASE_URL:
          "postgresql://postgres@localhost:5433/cvm_verify_template",
      })
    ).toBe(true);
    expect(realDrivesForbidden({ CVM_NO_REAL_DRIVES: "1" })).toBe(true);
  });
});

describe("realDriveReached — never touches /mnt", () => {
  const fakeFs = (links: Record<string, string>) => {
    const touched: string[] = [];
    return {
      touched,
      links: {
        lstat: (p: string) => {
          touched.push(p);
          if (p.startsWith("/mnt")) throw new Error(`touched ${p}`);
          return { isSymbolicLink: () => p in links };
        },
        readlink: (p: string) => links[p]!,
      },
    };
  };

  it("names a path on a real drive without a single lstat", () => {
    const { touched, links } = fakeFs({});
    expect(realDriveReached("/mnt/d/raw-footage/a.mkv", links)).toBe(
      "/mnt/d/raw-footage/a.mkv"
    );
    expect(touched).toEqual([]);
  });

  it("follows a symlink out to a real drive, stopping at the drive", () => {
    const { touched, links } = fakeFs({ "/home/m/Videos": "/mnt/c/Videos" });
    expect(realDriveReached("/home/m/Videos/take.mkv", links)).toBe(
      "/mnt/c/Videos/take.mkv"
    );
    expect(touched.every((p) => !p.startsWith("/mnt"))).toBe(true);
  });

  it("follows a relative symlink, .. and all", () => {
    const { links } = fakeFs({ "/a/b/link": "../../mnt/e" });
    expect(realDriveReached("/a/b/link/x.mkv", links)).toBe("/mnt/e/x.mkv");
  });

  it("is undefined for a path that stays off the drives", () => {
    const { links } = fakeFs({ "/a/link": "/b" });
    expect(realDriveReached("/a/link/c.mkv", links)).toBeUndefined();
    expect(realDriveReached("/mntx/c.mkv", links)).toBeUndefined();
  });

  it("refuses a symlink loop rather than follow it", () => {
    const { links } = fakeFs({ "/a/x": "/a/y", "/a/y": "/a/x" });
    expect(realDriveReached("/a/x/f", links)).toBeDefined();
  });
});

describe("Storage resolution in an agent's process", () => {
  let base: string;
  let scratch: string;
  let roots: StorageRoots;

  const resolve = (stored: string) =>
    Effect.runPromise(
      resolveStoragePath(stored, roots, "Footage").pipe(
        Effect.either,
        Effect.provide(NodeContext.layer)
      )
    );
  const find = (stored: string) =>
    Effect.runPromise(
      findStoragePath(stored, roots).pipe(Effect.provide(NodeContext.layer))
    );

  beforeEach(() => {
    base = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "real-drives-"))
    );
    scratch = path.join(base, "scratch");
    fs.mkdirSync(path.join(scratch, "raw-footage"), { recursive: true });
    roots = [scratch];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(base, { recursive: true, force: true });
  });

  const asAgent = () => vi.stubEnv("CVM_VERIFY_RUN_DIR", base);

  it("refuses a legacy absolute /mnt Clip path — the path the incident took", async () => {
    asAgent();
    const stored = "/mnt/d/raw-footage/2026-10-16 take.mkv";
    const result = await resolve(stored);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("StorageFileNotFoundError");
      expect(result.left.message).toBe(
        `Footage refused — on a real drive, which an agent's server never reads: ${stored}`
      );
    }
    expect(findStoragePathSync(stored, roots)).toBeNull();
    expect((await find(stored))._tag).toBe("None");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("is on a real drive (/mnt/d/raw-footage")
    );
  });

  it("refuses a path that reaches /mnt through a symlink", async () => {
    asAgent();
    const link = path.join(base, "Videos");
    fs.symlinkSync("/mnt/c/fake-videos", link);
    const result = await resolve(path.join(link, "take.mkv"));
    expect(Either.isLeft(result)).toBe(true);
    expect(findStoragePathSync(path.join(link, "take.mkv"), roots)).toBeNull();
  });

  it("refuses on a cvm_verify_* database too, with no run directory", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres@localhost:5433/cvm_verify_20261016_1"
    );
    expect(Either.isLeft(await resolve("/mnt/e/raw-footage/a.mkv"))).toBe(true);
  });

  it("still reads the run's own scratch Footage", async () => {
    asAgent();
    const take = path.join(scratch, "raw-footage", "a.mkv");
    fs.writeFileSync(take, "x");
    expect(await resolve("raw-footage/a.mkv")).toEqual(Either.right(take));
    expect(findStoragePathSync("raw-footage/a.mkv", roots)).toBe(take);
  });

  it("leaves Matt's own process alone: an unmanaged path is used as stored", async () => {
    vi.stubEnv("CVM_VERIFY_RUN_DIR", "");
    vi.stubEnv("CVM_NO_REAL_DRIVES", "");
    vi.stubEnv("DATABASE_URL", MATT.DATABASE_URL);
    const stored = "/mnt/d/raw-footage/a.mkv";
    expect(await resolve(stored)).toEqual(Either.right(stored));
    expect(findStoragePathSync(stored, roots)).toBe(stored);
  });
});
