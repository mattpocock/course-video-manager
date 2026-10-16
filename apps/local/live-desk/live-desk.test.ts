import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEAD_DESK_URL,
  forwarderRefusal,
  isMainCheckout,
  liveDeskAddresses,
} from "./live-desk";

let root: string;
let main: string;
let worktree: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "live-desk-"));
  main = join(root, "main");
  worktree = join(root, "wt");
  mkdirSync(join(main, "apps/local"), { recursive: true });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore" });
  git(main, "init", "-q", "-b", "main");
  git(
    main,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init"
  );
  git(main, "worktree", "add", "-q", worktree, "-b", "wt");
  mkdirSync(join(worktree, "apps/local"), { recursive: true });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("isMainCheckout", () => {
  // These repos live in the temp directory, itself agent scratch space: the
  // git tests run with no scratch roots, and the last one with them.
  const noScratch = { scratchRoots: [] };

  it("is true in the main checkout, from any subdirectory", () => {
    expect(isMainCheckout(main, noScratch)).toBe(true);
    expect(isMainCheckout(join(main, "apps/local"), noScratch)).toBe(true);
  });

  it("is false in a linked worktree", () => {
    expect(isMainCheckout(worktree, noScratch)).toBe(false);
    expect(isMainCheckout(join(worktree, "apps/local"), noScratch)).toBe(false);
  });

  it("fails closed outside any git repository", () => {
    expect(isMainCheckout(root, noScratch)).toBe(false);
    expect(isMainCheckout(join(root, "does-not-exist"), noScratch)).toBe(false);
  });

  it("is false in a full clone in an agent's scratch space (#2291)", () => {
    // A verify-cvm clone under ~/.claude/jobs passed the git test and
    // reached Matt's recorder service.
    expect(isMainCheckout(main, { scratchRoots: [root] })).toBe(false);
    expect(isMainCheckout(main)).toBe(false);
  });
});

describe("liveDeskAddresses", () => {
  it("gives the main checkout the live desk", () => {
    expect(liveDeskAddresses({ mainCheckout: true, explicit: {} })).toEqual({
      hub: "ws://localhost:5172",
    });
  });

  it("gives every other checkout the dead address", () => {
    expect(liveDeskAddresses({ mainCheckout: false, explicit: {} })).toEqual({
      hub: DEAD_DESK_URL,
    });
  });

  it("keeps an explicit override wherever it runs", () => {
    const explicit = { VITE_STREAM_DECK_HUB_URL: "ws://127.0.0.1:9" };
    for (const mainCheckout of [true, false]) {
      expect(liveDeskAddresses({ mainCheckout, explicit })).toEqual({
        hub: "ws://127.0.0.1:9",
      });
    }
  });
});

describe("forwarderRefusal", () => {
  it("lets the forwarder start only in the main checkout", () => {
    expect(
      forwarderRefusal(join(main, "apps/local"), { scratchRoots: [] })
    ).toBeUndefined();
    expect(forwarderRefusal(join(worktree, "apps/local"))).toMatch(
      /not the main checkout/
    );
  });
});
