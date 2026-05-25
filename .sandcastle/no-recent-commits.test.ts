import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SANDCASTLE_DIR = import.meta.dirname;

const promptFiles = readdirSync(SANDCASTLE_DIR, { recursive: true })
  .filter(
    (f): f is string =>
      typeof f === "string" &&
      f.endsWith(".md") &&
      // worktrees/ holds throwaway repo checkouts with stale prompt copies —
      // not part of this repo's prompts. (Also excluded from vitest collection
      // in vite.config.ts, but that doesn't govern files a test reads itself.)
      !f.split(/[/\\]/).includes("worktrees")
  )
  .map((rel) => [rel, join(SANDCASTLE_DIR, rel)] as const);

describe("sandcastle prompts", () => {
  it.each(promptFiles)(
    "%s must not contain a <recent-commits> section",
    (_rel, abs) => {
      const content = readFileSync(abs, "utf-8");
      expect(content).not.toMatch(/<recent-commits>/);
    }
  );
});
