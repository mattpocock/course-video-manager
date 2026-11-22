// The lint canary. A rule that silently stops firing looks exactly like a
// passing lint run, so `lint/canary/` plants one violation per rule family
// and this check fails unless Oxlint reports every one of them as an error.
//
// The root `.oxlintrc.json` ignores `lint/canary/`. Its own config,
// `lint/canary/canary.oxlintrc.json`, extends the root one and clears the
// ignore list, so the canary runs the real rules. (It is not named
// `.oxlintrc.json`: Oxlint would pick a nested one up on every root run.)
//
// Adding a rule: plant its violation in `lint/canary/` and add its code
// below, exactly as Oxlint's JSON reporter prints it.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const EXPECTED = [
  // A native rule from the `correctness` category.
  "eslint(no-debugger)",
  // A type-aware rule, through oxlint-tsgolint.
  "typescript(no-floating-promises)",
  // Each local rule.
  "local(no-overloads)",
];

const CONFIG = "lint/canary/canary.oxlintrc.json";
const OXLINT = "node_modules/oxlint/bin/oxlint";

function fail(message: string): never {
  console.error(`check-lint-canary: ${message}`);
  process.exit(1);
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  if (!existsSync(path.join(root, OXLINT))) {
    fail(`Oxlint is not installed (${OXLINT} is missing). Run pnpm install.`);
  }
  const run = spawnSync(
    process.execPath,
    [OXLINT, "-c", CONFIG, "--type-aware", "--format", "json", "lint/canary"],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 }
  );
  let diagnostics: { code: string; severity: string }[];
  try {
    diagnostics = (
      JSON.parse(run.stdout) as { diagnostics: typeof diagnostics }
    ).diagnostics;
    if (!Array.isArray(diagnostics)) throw new Error("no diagnostics array");
  } catch {
    fail(
      `Oxlint did not produce a JSON report (exit ${run.status}):\n${`${run.stderr}${run.stdout}`.trim()}`
    );
  }
  const reported = new Set(
    diagnostics.filter((d) => d.severity === "error").map((d) => d.code)
  );
  const missing = EXPECTED.filter((code) => !reported.has(code));
  if (missing.length > 0) {
    fail(
      `these rules no longer fail their planted violation in lint/canary/, so they have stopped gating:\n${missing.map((c) => `  ${c}`).join("\n")}\nCheck that each is still an error in .oxlintrc.json and that its plugin loads.`
    );
  }
  console.log(
    `check-lint-canary: all ${EXPECTED.length} canaries fail as they should.`
  );
}

main();
