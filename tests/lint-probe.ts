import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

export interface Diagnostic {
  filename: string;
  code: string;
  message: string;
  help?: string;
}

const isReport = (value: unknown): value is { diagnostics: Diagnostic[] } =>
  typeof value === "object" &&
  value !== null &&
  "diagnostics" in value &&
  Array.isArray(value.diagnostics);

/**
 * Lints probe files with the repo's real `.oxlintrc.json` and local plugin,
 * in a throwaway directory: each key of `files` is a repo-relative path and
 * its value the source planted there. `glossary` replaces the copy of the
 * repo's `GLOSSARY.md`. Returns Oxlint's diagnostics, and `remove` to delete
 * the directory.
 */
export const lintProbes = (
  files: Record<string, string>,
  { glossary }: { glossary?: string } = {}
) => {
  const dir = mkdtempSync(path.join(tmpdir(), "lint-probe-"));
  for (const file of [".oxlintrc.json", "GLOSSARY.md"]) {
    copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  if (glossary !== undefined) {
    writeFileSync(path.join(dir, "GLOSSARY.md"), glossary);
  }
  symlinkSync(path.join(ROOT, "lint"), path.join(dir, "lint"));
  mkdirSync(path.join(dir, "node_modules"));
  symlinkSync(
    realpathSync(path.join(ROOT, "node_modules/oxlint")),
    path.join(dir, "node_modules/oxlint")
  );
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), source);
  }
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/oxlint/bin/oxlint",
      "--format",
      "json",
      ...Object.keys(files),
    ],
    { cwd: dir, encoding: "utf8" }
  );
  const report: unknown = JSON.parse(run.stdout);
  if (!isReport(report)) throw new Error(`not an Oxlint report: ${run.stdout}`);
  return {
    diagnostics: report.diagnostics,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};
