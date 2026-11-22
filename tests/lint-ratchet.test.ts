// The lint ratchet, driven at its command-line seam: each test builds a
// throwaway repo (an Oxlint config, a baseline, some source files, a git
// history with an `origin/main`), runs `scripts/lint-ratchet.ts` in it, and
// reads the exit code, the output and the baseline it leaves behind.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/lint-ratchet.ts");
const DEBUGGER = "eslint(no-debugger)";
const EMPTY = "eslint(no-empty)";

const CONFIG = {
  categories: { correctness: "off" },
  ignorePatterns: ["node_modules/**"],
  rules: { "no-debugger": "error", "no-empty": "error" },
};

const debuggers = (n: number) => "debugger;\n".repeat(n);

type Baseline = Record<string, Record<string, number>>;

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

function installTools(dir: string, tools: { tsgolint?: boolean } = {}) {
  const modules = path.join(dir, "node_modules");
  mkdirSync(path.join(modules, ".bin"), { recursive: true });
  symlinkSync(
    realpathSync(path.join(ROOT, "node_modules/oxlint")),
    path.join(modules, "oxlint")
  );
  if (tools.tsgolint === false) return;
  const tsgolint = realpathSync(
    path.join(ROOT, "node_modules/oxlint-tsgolint")
  );
  symlinkSync(tsgolint, path.join(modules, "oxlint-tsgolint"));
  const shim = path.join(modules, ".bin/tsgolint");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec node "${tsgolint}/bin/tsgolint.js" "$@"\n`
  );
  chmodSync(shim, 0o755);
}

/**
 * A repo whose `origin/main` holds `files` and `baseline`. Pass `baseline:
 * null` for a repo with no baseline file.
 */
function makeRepo(opts: {
  files: Record<string, string>;
  baseline?: Baseline | null;
  tools?: { oxlint?: boolean; tsgolint?: boolean };
}) {
  const dir = mkdtempSync(path.join(tmpdir(), "lint-ratchet-"));
  repos.push(dir);
  if (opts.tools?.oxlint !== false) installTools(dir, opts.tools);
  writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  writeFileSync(path.join(dir, ".oxlintrc.json"), JSON.stringify(CONFIG));
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*"] })
  );
  if (opts.baseline !== null) writeBaseline(dir, opts.baseline ?? {});
  for (const [file, source] of Object.entries(opts.files)) {
    write(dir, file, source);
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(
    dir,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "-m",
    "base"
  );
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}

function write(dir: string, file: string, source: string) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), source);
}

function writeBaseline(dir: string, baseline: Baseline) {
  writeFileSync(
    path.join(dir, "lint-baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n"
  );
}

const readBaseline = (dir: string) =>
  readFileSync(path.join(dir, "lint-baseline.json"), "utf8");

function ratchet(dir: string, args: string[] = [], env: { CI?: string } = {}) {
  const { CI: _ci, ...rest } = process.env;
  const result = spawnSync("node", [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...rest, ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("check mode", () => {
  it("passes when every count is at its baseline", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(2) },
      baseline: { "a.ts": { [DEBUGGER]: 2 } },
    });
    expect(ratchet(dir)).toMatchObject({ status: 0 });
  });

  it("fails a rise, naming the file, the rule, the count and the baseline", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(2) },
      baseline: { "a.ts": { [DEBUGGER]: 2 } },
    });
    write(dir, "a.ts", debuggers(3));
    const result = ratchet(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`a.ts  ${DEBUGGER}: 3, baseline 2`);
    expect(result.output).toContain("a.ts:3:1");
  });

  it("fails a (file, rule) pair the baseline does not have", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(1), "b.ts": "" },
      baseline: { "a.ts": { [DEBUGGER]: 1 } },
    });
    write(dir, "b.ts", "if (1) {}\n");
    write(dir, "a.ts", `${debuggers(1)}if (1) {}\n`);
    const result = ratchet(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`b.ts  ${EMPTY}: 1, baseline 0`);
    expect(result.output).toContain(`a.ts  ${EMPTY}: 1, baseline 0`);
  });

  it("passes a fall without touching the baseline, and hints at --write", () => {
    const baseline = { "a.ts": { [DEBUGGER]: 2 } };
    const dir = makeRepo({ files: { "a.ts": debuggers(2) }, baseline });
    write(dir, "a.ts", debuggers(1));
    const result = ratchet(dir);
    expect(result.status).toBe(0);
    expect(result.output).toContain("--write would lower them");
    expect(JSON.parse(readBaseline(dir))).toEqual(baseline);
  });

  it("with file arguments, lints and compares only those files", () => {
    const dir = makeRepo({ files: { "a.ts": "", "b.ts": "" } });
    write(dir, "a.ts", debuggers(1));
    write(dir, "b.ts", debuggers(1));
    const result = ratchet(dir, ["b.ts", path.join(dir, "notes.md")]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`b.ts  ${DEBUGGER}: 1, baseline 0`);
    expect(result.output).not.toContain("a.ts");
    expect(ratchet(dir, ["notes.md"])).toMatchObject({ status: 0 });
  });

  it("passes staged files that the config ignores", () => {
    const dir = makeRepo({ files: { "vendor/a.ts": "" } });
    write(dir, "vendor/a.ts", debuggers(1));
    const config = {
      ...CONFIG,
      ignorePatterns: ["node_modules/**", "vendor/**"],
    };
    writeFileSync(path.join(dir, ".oxlintrc.json"), JSON.stringify(config));
    expect(ratchet(dir, ["vendor/a.ts"])).toMatchObject({ status: 0 });
  });

  it("lets a renamed file carry its counts", () => {
    const dir = makeRepo({
      files: { "old.ts": debuggers(2) },
      baseline: { "old.ts": { [DEBUGGER]: 2 } },
    });
    git(dir, "mv", "old.ts", "new.ts");
    expect(ratchet(dir)).toMatchObject({ status: 0 });
    expect(ratchet(dir, ["new.ts"])).toMatchObject({ status: 0 });
    write(dir, "new.ts", debuggers(3));
    expect(ratchet(dir).output).toContain(`new.ts  ${DEBUGGER}: 3, baseline 2`);
  });
});

describe("--write", () => {
  it("lowers a count and drops entries that reach zero", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(3), "b.ts": debuggers(1) },
      baseline: { "a.ts": { [DEBUGGER]: 3 }, "b.ts": { [DEBUGGER]: 1 } },
    });
    write(dir, "a.ts", debuggers(1));
    write(dir, "b.ts", "");
    expect(ratchet(dir, ["--write"])).toMatchObject({ status: 0 });
    expect(readBaseline(dir)).toBe(
      `{\n  "a.ts": {\n    "${DEBUGGER}": 1\n  }\n}\n`
    );
  });

  it("refuses a rise, writing nothing", () => {
    const baseline = { "a.ts": { [DEBUGGER]: 1 } };
    const dir = makeRepo({ files: { "a.ts": debuggers(1) }, baseline });
    write(dir, "a.ts", debuggers(2));
    const before = readBaseline(dir);
    const result = ratchet(dir, ["--write"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`a.ts  ${DEBUGGER}: 2, baseline 1`);
    expect(result.output).toContain("nothing was written");
    expect(readBaseline(dir)).toBe(before);
  });

  it("refuses file arguments", () => {
    const dir = makeRepo({ files: { "a.ts": "" } });
    const result = ratchet(dir, ["--write", "a.ts"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("takes no file arguments");
  });

  it("moves a renamed file's counts to its new path", () => {
    const dir = makeRepo({
      files: { "src/old.ts": debuggers(2) },
      baseline: { "src/old.ts": { [DEBUGGER]: 2 } },
    });
    mkdirSync(path.join(dir, "lib"));
    git(dir, "mv", "src/old.ts", "lib/new.ts");
    expect(ratchet(dir, ["--write"])).toMatchObject({ status: 0 });
    expect(JSON.parse(readBaseline(dir))).toEqual({
      "lib/new.ts": { [DEBUGGER]: 2 },
    });
  });

  it("refuses a renamed file above the old path's counts", () => {
    const dir = makeRepo({
      files: { "old.ts": debuggers(1) },
      baseline: { "old.ts": { [DEBUGGER]: 1 } },
    });
    git(dir, "mv", "old.ts", "new.ts");
    write(dir, "new.ts", debuggers(2));
    expect(ratchet(dir, ["--write"])).toMatchObject({ status: 1 });
  });
});

describe("--introduce", () => {
  it("records a newly switched-on rule's violations", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(1), "b.ts": "if (1) {}\nif (2) {}\n" },
      baseline: { "a.ts": { [DEBUGGER]: 1 } },
    });
    expect(ratchet(dir, ["--introduce", EMPTY])).toMatchObject({ status: 0 });
    expect(JSON.parse(readBaseline(dir))).toEqual({
      "a.ts": { [DEBUGGER]: 1 },
      "b.ts": { [EMPTY]: 2 },
    });
  });

  it("does not let other rules rise", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(1), "b.ts": "if (1) {}\n" },
      baseline: {},
    });
    const result = ratchet(dir, ["--introduce", EMPTY]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`a.ts  ${DEBUGGER}: 1, baseline 0`);
  });

  it("is refused for a rule that already has entries", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(2) },
      baseline: { "a.ts": { [DEBUGGER]: 1 } },
    });
    const before = readBaseline(dir);
    const result = ratchet(dir, ["--write", "--introduce", DEBUGGER]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("already has entries");
    expect(readBaseline(dir)).toBe(before);
  });
});

describe("the baseline compared with origin/main", () => {
  it("fails a hand-raised count", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(2) },
      baseline: { "a.ts": { [DEBUGGER]: 1 } },
    });
    writeBaseline(dir, { "a.ts": { [DEBUGGER]: 2 } });
    const result = ratchet(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`a.ts  ${DEBUGGER}: 2, origin/main has 1`);
  });

  it("fails a hand-added entry for a rule origin/main already ratchets", () => {
    const dir = makeRepo({
      files: { "a.ts": debuggers(1), "b.ts": debuggers(1) },
      baseline: { "a.ts": { [DEBUGGER]: 1 } },
    });
    writeBaseline(dir, {
      "a.ts": { [DEBUGGER]: 1 },
      "b.ts": { [DEBUGGER]: 1 },
    });
    expect(ratchet(dir).output).toContain(
      `b.ts  ${DEBUGGER}: 1, origin/main has 0`
    );
  });

  it("passes an introduction, a rule origin/main has no entries for", () => {
    const dir = makeRepo({
      files: { "a.ts": "if (1) {}\n" },
      baseline: {},
    });
    expect(ratchet(dir, ["--introduce", EMPTY])).toMatchObject({ status: 0 });
    expect(ratchet(dir, [], { CI: "true" })).toMatchObject({ status: 0 });
  });

  it("follows a rename", () => {
    const dir = makeRepo({
      files: { "old.ts": debuggers(1) },
      baseline: { "old.ts": { [DEBUGGER]: 1 } },
    });
    git(dir, "mv", "old.ts", "new.ts");
    expect(ratchet(dir, ["--write"])).toMatchObject({ status: 0 });
    expect(ratchet(dir, [], { CI: "true" })).toMatchObject({ status: 0 });
  });
});

describe("failing loudly", () => {
  it("fails when the baseline is missing", () => {
    const dir = makeRepo({ files: { "a.ts": "" }, baseline: null });
    const result = ratchet(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("lint-baseline.json is missing");
  });

  it("fails when the baseline is not JSON, or not counts", () => {
    const dir = makeRepo({ files: { "a.ts": "" } });
    writeFileSync(path.join(dir, "lint-baseline.json"), "{ nope");
    expect(ratchet(dir).output).toContain(
      "lint-baseline.json is not valid JSON"
    );
    writeFileSync(
      path.join(dir, "lint-baseline.json"),
      JSON.stringify({ "a.ts": { [DEBUGGER]: 0 } })
    );
    expect(ratchet(dir)).toMatchObject({ status: 1 });
  });

  it("fails in CI when origin/main is missing", () => {
    const dir = makeRepo({ files: { "a.ts": "" } });
    git(dir, "update-ref", "-d", "refs/remotes/origin/main");
    const result = ratchet(dir, [], { CI: "true" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("origin/main is missing");
    expect(ratchet(dir)).toMatchObject({ status: 0 });
  });

  it("fails when Oxlint is not installed", () => {
    const dir = makeRepo({ files: { "a.ts": "" }, tools: { oxlint: false } });
    const result = ratchet(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Oxlint is not installed");
  });

  it("fails when oxlint-tsgolint is not installed", () => {
    const dir = makeRepo({ files: { "a.ts": "" }, tools: { tsgolint: false } });
    const result = ratchet(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("oxlint-tsgolint is not installed");
  });

  it("fails when Oxlint's output is not a JSON report", () => {
    const dir = makeRepo({ files: { "a.ts": "" }, tools: { oxlint: false } });
    write(dir, "node_modules/oxlint/bin/oxlint", 'console.log("hello");\n');
    write(dir, "node_modules/.bin/tsgolint", "");
    const result = ratchet(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("did not produce a JSON report");
    expect(result.output).toContain("hello");
  });

  it("fails on an Oxlint config error", () => {
    const dir = makeRepo({ files: { "a.ts": "" } });
    writeFileSync(
      path.join(dir, ".oxlintrc.json"),
      JSON.stringify({ rules: { "no-such-plugin/rule": "error" } })
    );
    expect(ratchet(dir)).toMatchObject({ status: 1 });
    expect(existsSync(path.join(dir, "lint-baseline.json"))).toBe(true);
  });
});
