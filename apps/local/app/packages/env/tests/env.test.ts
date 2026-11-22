import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENV_NAMES,
  envEntries,
  findRepoRoot,
  readEnv,
  readEnvValue,
  resolveRepoEnvValue,
} from "@/packages/env";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cvm-env-"));
  dirs.push(dir);
  return dir;
};

const envFile = (contents: string) => {
  const file = path.join(tempDir(), ".env");
  writeFileSync(file, contents);
  return file;
};

describe("readEnv", () => {
  it("reads a variable that is set", () => {
    vi.stubEnv("CVM_LOG_SQL", "1");
    expect(readEnv("CVM_LOG_SQL")).toBe("1");
  });

  it("is undefined for a variable that is not set", () => {
    vi.stubEnv("CVM_LOG_SQL", undefined);
    expect(readEnv("CVM_LOG_SQL")).toBeUndefined();
  });
});

describe("the repo-root .env reader", () => {
  it("parses every assignment, skipping comments and blanks and stripping one layer of quotes", () => {
    const file = envFile(
      `# a comment\n\nA=1\nB="two words"\nC='x'\nnot an assignment\n=empty key\nA=again\n`
    );
    expect([...envEntries(file)]).toEqual([
      ["A", "1"],
      ["B", "two words"],
      ["C", "x"],
      ["A", "again"],
    ]);
  });

  it("reads the first value a key is assigned", () => {
    expect(readEnvValue(envFile("K=first\nK=second\n"), "K")).toBe("first");
    expect(readEnvValue(envFile("K=1\n"), "MISSING")).toBeUndefined();
  });

  it("finds the workspace root, not the nearest package.json", () => {
    const root = tempDir();
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "");
    const app = path.join(root, "apps/local/app");
    mkdirSync(app, { recursive: true });
    writeFileSync(path.join(root, "apps/local/package.json"), "{}");
    expect(findRepoRoot(app)).toBe(root);
    expect(findRepoRoot(tempDir())).toBeUndefined();
  });

  it("lets a variable that is already set win over the .env file", () => {
    vi.stubEnv("CVM_ENV_PACKAGE_PROBE", "from-environment");
    expect(resolveRepoEnvValue("CVM_ENV_PACKAGE_PROBE")).toBe(
      "from-environment"
    );
  });
});

describe("ENV_NAMES", () => {
  it("is every key .env.example documents, commented-out optional ones included", () => {
    const example = readFileSync(
      path.resolve(import.meta.dirname, "../../../../../../.env.example"),
      "utf8"
    );
    const documented = [...example.matchAll(/^#?\s*([A-Z_0-9]+)=/gm)].map(
      (match) => match[1]
    );
    expect([...ENV_NAMES].sort()).toEqual([...new Set(documented)].sort());
  });
});
