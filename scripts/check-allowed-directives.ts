/**
 * The two checks on `lint/allowed-directives.json` that Oxlint cannot make.
 * A disable directive that names `allowed-directives` silences that rule's
 * report on itself, so it fails here; and an entry whose directive is no
 * longer in its file is stale. Checks the tracked files, or only the files
 * given, and every entry each run. `lint/canary/` is checked only under
 * `--canary`, which the lint canary passes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import { directiveOf } from "../lint/rules/directives.ts";

const ALLOWLIST = "lint/allowed-directives.json";
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SELF_DISABLE = /^(?:oxlint|eslint)-disable\S*\s.*\ballowed-directives\b/;

class GuardError extends Error {}

interface Entry {
  file: string;
  directive: string;
}

const readAllowlist = (): Entry[] => {
  if (!existsSync(ALLOWLIST)) throw new GuardError(`${ALLOWLIST} is missing.`);
  let entries: unknown;
  try {
    entries = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
  } catch {
    entries = undefined;
  }
  const valid =
    Array.isArray(entries) &&
    entries.every(
      (e: { file?: unknown; directive?: unknown }) =>
        typeof e?.file === "string" && typeof e.directive === "string"
    );
  if (!valid) {
    throw new GuardError(
      `${ALLOWLIST} must be a JSON list of { "file", "directive", "reason" } entries.`
    );
  }
  return entries as Entry[];
};

const directivesIn = (file: string) => {
  const source = readFileSync(file, "utf8");
  const { comments } = parseSync(file, source);
  return comments.flatMap((comment) => {
    const directive = directiveOf(comment.value);
    if (directive === undefined) return [];
    const line = source.slice(0, comment.start).split("\n").length;
    return [{ directive, line }];
  });
};

const isCanary = (file: string) =>
  path
    .relative(process.cwd(), file)
    .startsWith(`lint${path.sep}canary${path.sep}`);

const filesToScan = (args: readonly string[], canary: boolean) =>
  (args.length > 0
    ? args
    : execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard"],
        { encoding: "utf8" }
      ).split("\n")
  ).filter(
    (file) => CODE.test(file) && existsSync(file) && isCanary(file) === canary
  );

function main(args: readonly string[], canary: boolean) {
  const entries = readAllowlist();
  const problems: string[] = [];
  for (const file of filesToScan(args, canary)) {
    for (const { directive, line } of directivesIn(file)) {
      if (SELF_DISABLE.test(directive)) {
        problems.push(
          `${file}:${line}  '${directive}' silences local/allowed-directives itself. Name only the rules it disables, and put it on the allowlist with a reason.`
        );
      }
    }
  }
  for (const { file, directive } of entries) {
    const present =
      existsSync(file) &&
      directivesIn(file).some((found) => found.directive === directive);
    if (!present) {
      problems.push(
        `${ALLOWLIST}  '${directive}' is no longer in ${file}. Delete the entry.`
      );
    }
  }
  if (problems.length > 0) {
    throw new GuardError(problems.join("\n"));
  }
}

try {
  const args = process.argv.slice(2);
  main(
    args.filter((arg) => !arg.startsWith("--")),
    args.includes("--canary")
  );
} catch (error) {
  if (!(error instanceof GuardError)) throw error;
  console.error(`check-allowed-directives: ${error.message}`);
  process.exitCode = 1;
}
