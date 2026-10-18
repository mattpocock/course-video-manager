// Cyclomatic complexity, held to a shrink-only allowlist.
//
// `.oxlintrc.json` makes oxlint's `complexity` rule an error (threshold and
// variant live there, nowhere else). The functions that already broke it when
// the rule landed sit in files listed in `scripts/complexity-allowlist.json`,
// each with the number of its functions over the limit; `.oxlintrc.json` turns
// the rule off for exactly those files. This guard keeps that list honest:
//
// 1. An allowlisted file may not gain an over-limit function (count above its
//    entry), and may not lose one without the entry going down with it (count
//    below its entry: lower it, or delete the entry once it reaches 0).
// 2. The list may not grow against the base branch: no new file, no higher
//    count than `origin/main` has.
// 3. The `.oxlintrc.json` override names exactly the allowlisted files.
// 4. No `eslint-disable` / `oxlint-disable` comment names `complexity`.
//
// The fix for an over-limit function is to split it — extract helpers, or move
// the decision into a reducer with one small handler per event — never a
// disable comment. See CODING_STANDARDS.md, "Functions stay simple".
//
// The whole repo is linted every run (oxlint takes well under a second), so
// pre-commit and CI (`--all`, accepted for symmetry) do the same work.
// `--report` prints every over-limit function, worst first.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const ALLOWLIST_PATH = "scripts/complexity-allowlist.json";
export const OXLINTRC_PATH = ".oxlintrc.json";
/** The guard and its test name the comment they look for. */
const GUARD_FILES = new Set([
  "scripts/check-complexity.ts",
  "tests/complexity-guard.test.ts",
]);
export const STANDARD = 'CODING_STANDARDS.md, "Functions stay simple"';

/** file → number of its functions over the limit. */
export type Allowlist = Record<string, number>;

export interface Offender {
  file: string;
  line: number;
  complexity: number;
}

export interface RuleConfig {
  max: number;
  variant: string;
  ignorePatterns: string[];
  /** Plain file paths the `complexity: "off"` legacy override names. */
  overrideFiles: string[];
  /** Glob patterns the rule is off for (tests). */
  offPatterns: string[];
}

const isGlob = (p: string) => /[*?{[]/.test(p);

/** `.oxlintrc.json` is JSONC; every comment in it is a whole line. */
export function readRuleConfig(source: string): RuleConfig {
  const json = JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as {
    ignorePatterns?: string[];
    rules?: Record<string, unknown>;
    overrides?: { files: string[]; rules?: Record<string, unknown> }[];
  };
  const rule = json.rules?.complexity;
  if (!Array.isArray(rule) || typeof rule[1]?.max !== "number") {
    throw new Error(
      `${OXLINTRC_PATH}: expected "complexity": ["error", { "max": N, "variant": ... }]`
    );
  }
  const overrideFiles: string[] = [];
  const offPatterns: string[] = [];
  for (const o of json.overrides ?? []) {
    if (o.rules?.complexity !== "off") continue;
    for (const f of o.files) (isGlob(f) ? offPatterns : overrideFiles).push(f);
  }
  return {
    max: rule[1].max,
    variant: rule[1].variant ?? "classic",
    ignorePatterns: json.ignorePatterns ?? [],
    overrideFiles,
    offPatterns,
  };
}

/** Over-limit functions per file. */
export function countByFile(offenders: readonly Offender[]): Allowlist {
  const counts: Allowlist = {};
  for (const o of offenders) counts[o.file] = (counts[o.file] ?? 0) + 1;
  return counts;
}

const ADVICE =
  "Split the function: extract helpers, or move the decision into a reducer " +
  `with one small handler per event. No disable comments. See ${STANDARD}.`;

function overLimit(
  offenders: readonly Offender[],
  found: Allowlist,
  allowlist: Allowlist,
  max: number
): string[] {
  const problems: string[] = [];
  for (const [file, count] of Object.entries(found)) {
    const allowed = allowlist[file];
    if (allowed !== undefined && count <= allowed) continue;
    const lines = offenders
      .filter((o) => o.file === file)
      .map((o) => `${o.line} (${o.complexity})`)
      .join(", ");
    problems.push(
      `${file}: ${count} function(s) over complexity ${max}` +
        (allowed === undefined ? "" : `, its allowlist entry says ${allowed}`) +
        `. ${ADVICE}\n      line (complexity): ${lines}`
    );
  }
  return problems;
}

function stale(found: Allowlist, allowlist: Allowlist): string[] {
  const problems: string[] = [];
  for (const [file, allowed] of Object.entries(allowlist)) {
    const count = found[file] ?? 0;
    if (count >= allowed) continue;
    const fix =
      count === 0
        ? `delete the entry in ${ALLOWLIST_PATH} and its line in the ${OXLINTRC_PATH} override`
        : `lower the count to ${count} in ${ALLOWLIST_PATH}`;
    problems.push(
      `${file}: the allowlist says ${allowed}, found ${count}. The list only shrinks: ${fix}.`
    );
  }
  return problems;
}

function grown(allowlist: Allowlist, base: Allowlist): string[] {
  const problems: string[] = [];
  for (const [file, allowed] of Object.entries(allowlist)) {
    const before = base[file];
    if (before === undefined) {
      problems.push(
        `${file}: new allowlist entry. The list only shrinks. ${ADVICE}`
      );
    } else if (allowed > before) {
      problems.push(
        `${file}: allowlist count went up from ${before} to ${allowed}. The list only shrinks. ${ADVICE}`
      );
    }
  }
  return problems;
}

function outOfSync(
  allowlist: Allowlist,
  overrideFiles: readonly string[]
): string[] {
  const listed = Object.keys(allowlist);
  const overridden = new Set(overrideFiles);
  const missing = listed
    .filter((f) => !overridden.has(f))
    .map(
      (f) =>
        `${f}: in ${ALLOWLIST_PATH} but not in the ${OXLINTRC_PATH} complexity override.`
    );
  const extra = overrideFiles
    .filter((f) => !(f in allowlist))
    .map(
      (f) =>
        `${f}: in the ${OXLINTRC_PATH} complexity override but not in ${ALLOWLIST_PATH}.`
    );
  return [...missing, ...extra];
}

/**
 * Every problem with the measured `offenders` against `allowlist`. `base` is
 * the allowlist on the base branch (undefined when it cannot be read).
 */
export function compare(args: {
  offenders: readonly Offender[];
  allowlist: Allowlist;
  base: Allowlist | undefined;
  overrideFiles: readonly string[];
  max: number;
}): string[] {
  const { offenders, allowlist, base, overrideFiles, max } = args;
  const found = countByFile(offenders);
  return [
    ...overLimit(offenders, found, allowlist, max),
    ...stale(found, allowlist),
    ...(base ? grown(allowlist, base) : []),
    ...outOfSync(allowlist, overrideFiles),
  ];
}

/** Disable comments that name the complexity rule. */
export function findDisableComments(file: string, source: string): string[] {
  const hits: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (/(eslint|oxlint)-disable[^\n]*\bcomplexity\b/.test(line)) {
      hits.push(`${file}:${i + 1}`);
    }
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Running oxlint

function measure(root: string, config: RuleConfig): Offender[] {
  const dir = mkdtempSync(path.join(tmpdir(), "check-complexity-"));
  try {
    const configPath = path.join(dir, "oxlintrc.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        categories: { correctness: "off" },
        rules: {
          complexity: ["error", { max: config.max, variant: config.variant }],
        },
      })
    );
    const ignores = [...config.ignorePatterns, ...config.offPatterns].map(
      (p) => `--ignore-pattern=${p}`
    );
    let out: string;
    try {
      out = execFileSync(
        "pnpm",
        [
          "exec",
          "oxlint",
          "-c",
          configPath,
          "--format",
          "json",
          ...ignores,
          ".",
        ],
        { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
      );
    } catch (error) {
      // oxlint exits 1 when it finds anything; the JSON is still on stdout.
      out = (error as { stdout?: string }).stdout ?? "";
      if (!out) throw error;
    }
    const { diagnostics } = JSON.parse(out) as {
      diagnostics: {
        code: string;
        message: string;
        filename: string;
        labels: { span: { line: number } }[];
      }[];
    };
    return diagnostics
      .filter((d) => d.code === "eslint(complexity)")
      .map((d) => ({
        file: d.filename,
        line: d.labels[0]?.span.line ?? 0,
        complexity: Number(/complexity of (\d+)/.exec(d.message)?.[1] ?? 0),
      }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readBase(root: string): Allowlist | undefined {
  const ref = "origin/main";
  try {
    return JSON.parse(
      execFileSync("git", ["show", `${ref}:${ALLOWLIST_PATH}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    ) as Allowlist;
  } catch {
    console.warn(
      `check-complexity: could not read ${ALLOWLIST_PATH} at ${ref}; skipping the growth check.`
    );
    return undefined;
  }
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const config = readRuleConfig(
    readFileSync(path.join(root, OXLINTRC_PATH), "utf8")
  );
  const offenders = measure(root, config);

  if (process.argv.includes("--report")) {
    for (const o of [...offenders].sort(
      (a, b) => b.complexity - a.complexity
    )) {
      console.log(`${o.complexity}\t${o.file}:${o.line}`);
    }
    return;
  }

  const allowlist = JSON.parse(
    readFileSync(path.join(root, ALLOWLIST_PATH), "utf8")
  ) as Allowlist;

  const problems = compare({
    offenders,
    allowlist,
    base: readBase(root),
    overrideFiles: config.overrideFiles,
    max: config.max,
  });

  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !GUARD_FILES.has(f));
  for (const file of tracked) {
    let source: string;
    try {
      source = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    if (!source.includes("complexity")) continue;
    for (const hit of findDisableComments(file, source)) {
      problems.push(`${hit}: disables the complexity rule. ${ADVICE}`);
    }
  }

  if (problems.length > 0) {
    console.error("\nERROR: function complexity:\n");
    for (const p of problems) console.error(`  ${p}\n`);
    console.error(
      `The limit is ${config.max} (${config.variant}), set in ${OXLINTRC_PATH}. The guard is scripts/check-complexity.ts.`
    );
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
