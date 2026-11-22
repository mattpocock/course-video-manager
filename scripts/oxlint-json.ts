import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const OXLINT = "node_modules/oxlint/bin/oxlint";
const TSGOLINT = "node_modules/.bin/tsgolint";

export interface Diagnostic {
  filename: string;
  code: string;
  severity: string;
  message: string;
  labels?: { span: { line: number; column: number } }[];
}

export class LintToolError extends Error {}

/**
 * Runs type-aware Oxlint in `root` with the JSON reporter and returns its
 * diagnostics, with filenames relative to `root`. Oxlint's own diagnostics,
 * which carry no rule code, get one: an unused disable directive is
 * `oxlint(unused-disable-directive)`. Throws `LintToolError` when
 * Oxlint or oxlint-tsgolint is not installed, or when the output is not a
 * JSON report (a config error, a crash).
 */
export function runOxlint(root: string, args: readonly string[]): Diagnostic[] {
  if (!existsSync(path.join(root, OXLINT))) {
    throw new LintToolError(
      `Oxlint is not installed (${OXLINT} is missing). Run pnpm install.`
    );
  }
  if (!existsSync(path.join(root, TSGOLINT))) {
    throw new LintToolError(
      `oxlint-tsgolint is not installed (${TSGOLINT} is missing), so the type-aware rules cannot run. Run pnpm install.`
    );
  }
  const run = spawnSync(
    process.execPath,
    [OXLINT, "--type-aware", "--format", "json", ...args],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }
  );
  const stdout = run.stdout ?? "";
  let diagnostics: unknown;
  try {
    diagnostics = (JSON.parse(stdout) as { diagnostics?: unknown }).diagnostics;
  } catch {
    diagnostics = undefined;
  }
  if (!Array.isArray(diagnostics) || (run.status !== 0 && run.status !== 1)) {
    throw new LintToolError(
      `Oxlint did not produce a JSON report (exit ${run.status}):\n${`${run.stderr ?? ""}${stdout}`.trim()}`
    );
  }
  return (diagnostics as (Omit<Diagnostic, "code"> & { code?: string })[]).map(
    (d) => ({
      ...d,
      code: d.code ?? ownCode(d.message),
      filename: toRepoPath(root, d.filename),
    })
  );
}

const ownCode = (message: string) =>
  /^Unused \S+ directive/.test(message)
    ? "oxlint(unused-disable-directive)"
    : "oxlint";

export const toRepoPath = (root: string, file: string) =>
  path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
