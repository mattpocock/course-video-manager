import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const RULE = "local(fs-writes)";

const PROBE = [
  'import fs from "node:fs";',
  'import { assertUnder } from "./assert-under";',
  "export const raw = (filePath: string) => fs.rmSync(filePath);",
  "export const guarded = (filePath: string) =>",
  '  fs.rmSync(assertUnder("/base", filePath));',
  "",
].join("\n");

const FILES: Record<string, number> = {
  "apps/local/app/routes/probe.ts": 1,
  "apps/local/app/routes/probe.tsx": 1,
  "apps/local/app/routes/probe.test.ts": 1,
  "apps/local/app/services/probe.ts": 1,
  "apps/local/app/services/nested/probe.ts": 1,
  "apps/local/app/services/probe.test.ts": 1,
  "apps/local/app/services/probe-test-harness.ts": 1,
  "apps/local/app/services/test-utils/probe.ts": 1,
  "apps/local/app/services/remove-best-effort.ts": 0,
  "apps/local/app/features/probe/probe.ts": 0,
  "packages/core/services/probe.ts": 0,
};

interface Diagnostic {
  filename: string;
  code: string;
  message: string;
}

const isReport = (value: unknown): value is { diagnostics: Diagnostic[] } =>
  typeof value === "object" &&
  value !== null &&
  "diagnostics" in value &&
  Array.isArray(value.diagnostics);

const isOverride = (
  value: unknown
): value is { files: string[]; rules: Record<string, unknown> } =>
  typeof value === "object" &&
  value !== null &&
  "files" in value &&
  Array.isArray(value.files) &&
  "rules" in value &&
  typeof value.rules === "object" &&
  value.rules !== null;

const ownerPaths = () => {
  const source = readFileSync(path.join(ROOT, ".oxlintrc.json"), "utf8");
  const config: unknown = JSON.parse(
    source.replace(
      /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      (_, string: string | undefined) => string ?? ""
    )
  );
  const overrides: unknown[] =
    typeof config === "object" &&
    config !== null &&
    "overrides" in config &&
    Array.isArray(config.overrides)
      ? config.overrides
      : [];
  return overrides
    .filter(isOverride)
    .filter((o) =>
      Object.entries(o.rules).some(
        ([r, v]) => r === "local/fs-writes" && v === "off"
      )
    )
    .flatMap((o) => o.files);
};

let dir: string;
let diagnostics: Diagnostic[];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "fs-writes-"));
  copyFileSync(
    path.join(ROOT, ".oxlintrc.json"),
    path.join(dir, ".oxlintrc.json")
  );
  symlinkSync(path.join(ROOT, "lint"), path.join(dir, "lint"));
  mkdirSync(path.join(dir, "node_modules"));
  symlinkSync(
    realpathSync(path.join(ROOT, "node_modules/oxlint")),
    path.join(dir, "node_modules/oxlint")
  );
  for (const file of Object.keys(FILES)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), PROBE);
  }
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/oxlint/bin/oxlint",
      "--format",
      "json",
      ...Object.keys(FILES),
    ],
    { cwd: dir, encoding: "utf8" }
  );
  const report: unknown = JSON.parse(run.stdout);
  if (!isReport(report)) throw new Error(`not an Oxlint report: ${run.stdout}`);
  diagnostics = report.diagnostics.filter((d) => d.code === RULE);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("local/fs-writes in the repo config", () => {
  it.each(Object.entries(FILES))(
    "%s reports %i unguarded write",
    (file, count) => {
      expect(diagnostics.filter((d) => d.filename === file)).toHaveLength(
        count
      );
    }
  );

  it("names the guard and how to use it", () => {
    expect(diagnostics[0]?.message).toContain(
      "assertUnder / assertUnderEffect (apps/local/app/services/assert-under.ts)"
    );
    expect(diagnostics[0]?.message).toContain(
      "const target = yield* assertUnderEffect(getVideoFilesBaseDir(), row.filePath)"
    );
  });

  it("turns the rule off only for owner paths that exist", () => {
    const owners = ownerPaths();
    expect(owners).toEqual(["apps/local/app/services/remove-best-effort.ts"]);
    for (const owner of owners) {
      expect(existsSync(path.join(ROOT, owner)), owner).toBe(true);
    }
  });
});
