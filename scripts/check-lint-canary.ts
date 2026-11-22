/**
 * The lint canary. Lints the planted violations in `lint/canary/` with
 * `canary.oxlintrc.json` (the root config, minus its ignore of that folder)
 * and fails unless each code in `EXPECTED` is reported as an error. A new
 * rule plants its violation there and adds its code here.
 */
import path from "node:path";
import { LintToolError, runOxlint } from "./oxlint-json.ts";

const EXPECTED = [
  "eslint(no-debugger)",
  "typescript(no-floating-promises)",
  "local(no-overloads)",
];

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const diagnostics = runOxlint(root, [
    "-c",
    "lint/canary/canary.oxlintrc.json",
    "lint/canary",
  ]);
  const reported = new Set(
    diagnostics.filter((d) => d.severity === "error").map((d) => d.code)
  );
  const missing = EXPECTED.filter((code) => !reported.has(code));
  if (missing.length > 0) {
    throw new LintToolError(
      `these rules no longer fail their planted violation in lint/canary/, so they have stopped gating:\n${missing.map((c) => `  ${c}`).join("\n")}\nCheck that each is still an error in .oxlintrc.json and that its plugin loads.`
    );
  }
  console.log(
    `check-lint-canary: all ${EXPECTED.length} canaries fail as they should.`
  );
}

try {
  main();
} catch (error) {
  if (!(error instanceof LintToolError)) throw error;
  console.error(`check-lint-canary: ${error.message}`);
  process.exitCode = 1;
}
