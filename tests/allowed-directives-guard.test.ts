import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../scripts/check-allowed-directives.ts"
);
const ALLOWLIST = "lint/allowed-directives.json";

interface Entry {
  file: string;
  directive: string;
  reason: string;
}

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function write(dir: string, file: string, source: string) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), source);
}

function makeRepo(files: Record<string, string>, allowlist: Entry[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "allowed-directives-"));
  repos.push(dir);
  write(dir, ALLOWLIST, JSON.stringify(allowlist));
  for (const [file, source] of Object.entries(files)) write(dir, file, source);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

function guard(dir: string, args: string[] = []) {
  const result = spawnSync("node", [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

const entry = (file: string, directive: string): Entry => ({
  file,
  directive,
  reason: "A reason.",
});

describe("a directive that silences local/allowed-directives", () => {
  it("passes a repo whose directives name other rules", () => {
    const dir = makeRepo({
      "a.ts": "// oxlint-disable-next-line no-debugger\ndebugger;\n",
    });
    expect(guard(dir)).toMatchObject({ status: 0 });
  });

  it("fails a disable-line directive that names it, with the file and line", () => {
    const dir = makeRepo({
      "a.ts":
        "export {};\ndebugger; // oxlint-disable-line local/allowed-directives, no-debugger\n",
    });
    const result = guard(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("a.ts:2");
    expect(result.output).toContain(
      "oxlint-disable-line local/allowed-directives, no-debugger"
    );
  });

  it("fails a block disable that names it", () => {
    const dir = makeRepo({
      "src/b.tsx":
        "/* eslint-disable local/allowed-directives */\nexport const b = 1;\n",
    });
    const result = guard(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("src/b.tsx:1");
  });

  it("passes the rule's name inside a string", () => {
    const dir = makeRepo({
      "a.ts":
        'export const s = "// oxlint-disable-line local/allowed-directives";\n',
    });
    expect(guard(dir)).toMatchObject({ status: 0 });
  });

  it("skips lint/canary, and checks only it under --canary", () => {
    const dir = makeRepo({
      "lint/canary/self.ts":
        "debugger; // oxlint-disable-line local/allowed-directives\n",
    });
    expect(guard(dir)).toMatchObject({ status: 0 });
    expect(guard(dir, ["lint/canary/self.ts"])).toMatchObject({ status: 0 });
    expect(
      guard(dir, ["--canary", path.join(dir, "lint/canary/self.ts")])
    ).toMatchObject({ status: 1 });
  });

  it("with file arguments, checks only those files", () => {
    const dir = makeRepo({
      "a.ts": "debugger; // oxlint-disable-line local/allowed-directives\n",
      "b.ts": "export {};\n",
    });
    expect(guard(dir, ["b.ts", ALLOWLIST])).toMatchObject({ status: 0 });
    expect(guard(dir, ["a.ts"])).toMatchObject({ status: 1 });
  });
});

describe("a stale allowlist entry", () => {
  it("passes an entry whose directive is still in its file", () => {
    const dir = makeRepo(
      { "a.ts": "// @ts-expect-error a reason here\nconst n: number = 'a';\n" },
      [entry("a.ts", "@ts-expect-error a reason here")]
    );
    expect(guard(dir)).toMatchObject({ status: 0 });
  });

  it("fails an entry whose directive is gone from its file", () => {
    const dir = makeRepo({ "a.ts": "export const n = 1;\n" }, [
      entry("a.ts", "@effect-diagnostics-next-line floatingEffect:off"),
    ]);
    const result = guard(dir, ["a.ts"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "'@effect-diagnostics-next-line floatingEffect:off' is no longer in a.ts"
    );
  });

  it("fails an entry whose file is gone", () => {
    const dir = makeRepo({}, [
      entry("gone.ts", "eslint-disable-next-line no-empty"),
    ]);
    const result = guard(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("is no longer in gone.ts");
  });
});

describe("failing loudly", () => {
  it("fails when the allowlist is missing", () => {
    const dir = makeRepo({ "a.ts": "export {};\n" });
    rmSync(path.join(dir, ALLOWLIST));
    const result = guard(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain(ALLOWLIST);
  });

  it("fails when the allowlist is not a list of entries", () => {
    const dir = makeRepo({ "a.ts": "export {};\n" });
    write(dir, ALLOWLIST, '{ "a.ts": 1 }');
    const result = guard(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain(ALLOWLIST);
  });
});
