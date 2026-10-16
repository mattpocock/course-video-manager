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
  it("is true in the main checkout, from any subdirectory", () => {
    expect(isMainCheckout(main)).toBe(true);
    expect(isMainCheckout(join(main, "apps/local"))).toBe(true);
  });

  it("is false in a linked worktree", () => {
    expect(isMainCheckout(worktree)).toBe(false);
    expect(isMainCheckout(join(worktree, "apps/local"))).toBe(false);
  });

  it("fails closed outside any git repository", () => {
    expect(isMainCheckout(root)).toBe(false);
    expect(isMainCheckout(join(root, "does-not-exist"))).toBe(false);
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
    expect(forwarderRefusal(join(main, "apps/local"))).toBeUndefined();
    expect(forwarderRefusal(join(worktree, "apps/local"))).toMatch(
      /not the main checkout/
    );
  });
});
