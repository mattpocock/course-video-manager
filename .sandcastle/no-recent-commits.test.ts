import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "node:fs";

const SANDCASTLE_DIR = join(import.meta.dirname, ".");

const promptFiles = globSync("**/*.md", { cwd: SANDCASTLE_DIR }).map(
  (rel) => [rel, join(SANDCASTLE_DIR, rel)] as const
);

describe("sandcastle prompts", () => {
  it.each(promptFiles)(
    "%s must not contain a <recent-commits> section",
    (_rel, abs) => {
      const content = readFileSync(abs, "utf-8");
      expect(content).not.toMatch(/<recent-commits>/);
    }
  );
});
