// The lint ratchet. Every Oxlint rule is an error; the violations that
// already existed when a rule was switched on are counted, per file and per
// rule, in `lint-baseline.json`. A count may fall but never rise.
//
//   node scripts/lint-ratchet.ts                 whole repo (CI, check:static)
//   node scripts/lint-ratchet.ts <file>...       only those files (pre-commit)
//   node scripts/lint-ratchet.ts --write         lower the baseline to match
//   node scripts/lint-ratchet.ts --introduce <rule>   (repeatable) record a
//                                                newly switched-on rule's
//                                                violations; implies --write
//
// Check mode fails when a (file, rule) count is above its baseline, printing
// each offender and its diagnostics. A count below the baseline passes, so a
// fix never has to touch the baseline file; `--write` locks it in.
//
// `--write` lints the whole repo and refuses, writing nothing, if any count
// would rise. A file that git reports as a rename of a baselined file, against
// origin/main, carries the old path's counts, in check mode too. A whole-repo
// check also compares the baseline with origin/main's copy, and fails on any
// raised count unless origin/main has no entries for that rule at all (an
// introduction). In CI, a missing origin/main is a failure.
//
// Anything that stops the check from running (no baseline, an unparseable
// one, a missing tool, a report that is not JSON) fails with the reason.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const BASELINE_PATH = "lint-baseline.json";
const BASE_REF = "origin/main";
const LINTABLE = /\.[cm]?[jt]sx?$/;
const OXLINT = "node_modules/oxlint/bin/oxlint";
const TSGOLINT = "node_modules/.bin/tsgolint";

/** file → rule code (as Oxlint's JSON reporter prints it) → count. */
export type Baseline = Record<string, Record<string, number>>;

interface Diagnostic {
  filename: string;
  code: string;
  message: string;
  labels?: { span: { line: number; column: number } }[];
}

class RatchetError extends Error {}
const fail = (message: string): never => {
  throw new RatchetError(message);
};

interface Args {
  write: boolean;
  introduce: string[];
  files: string[];
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { write: false, introduce: [], files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--write") args.write = true;
    else if (arg === "--introduce") {
      const rule = argv[++i];
      if (!rule || rule.startsWith("--")) fail("--introduce needs a rule code");
      args.introduce.push(rule!);
      args.write = true;
    } else if (arg.startsWith("--")) fail(`unknown flag ${arg}`);
    else args.files.push(arg);
  }
  if (args.write && args.files.length > 0) {
    fail("--write lints the whole repo; it takes no file arguments");
  }
  return args;
}

function git(root: string, args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

function lint(root: string, files: readonly string[]): Diagnostic[] {
  if (!existsSync(path.join(root, OXLINT))) {
    fail(`Oxlint is not installed (${OXLINT} is missing). Run pnpm install.`);
  }
  if (!existsSync(path.join(root, TSGOLINT))) {
    fail(
      `oxlint-tsgolint is not installed (${TSGOLINT} is missing), so the type-aware rules cannot run. Run pnpm install.`
    );
  }
  // Staged files the config ignores are not an error: they are not linted.
  const paths =
    files.length > 0 ? ["--no-error-on-unmatched-pattern", ...files] : [];
  const run = spawnSync(
    process.execPath,
    [OXLINT, "--type-aware", "--format", "json", ...paths],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }
  );
  const output = `${run.stdout ?? ""}`;
  let report: unknown;
  try {
    report = JSON.parse(output);
  } catch {
    report = undefined;
  }
  const diagnostics = (report as { diagnostics?: unknown } | undefined)
    ?.diagnostics;
  if (!Array.isArray(diagnostics) || (run.status !== 0 && run.status !== 1)) {
    fail(
      `Oxlint did not produce a JSON report (exit ${run.status}):\n${`${run.stderr ?? ""}${output}`.trim()}`
    );
  }
  return (diagnostics as Diagnostic[]).map((d) => ({
    ...d,
    filename: relative(root, d.filename),
  }));
}

const relative = (root: string, file: string) =>
  path.relative(root, path.resolve(root, file)).split(path.sep).join("/");

export function countDiagnostics(diagnostics: readonly Diagnostic[]): Baseline {
  const counts: Baseline = {};
  for (const { filename, code } of diagnostics) {
    const rules = (counts[filename] ??= {});
    rules[code] = (rules[code] ?? 0) + 1;
  }
  return counts;
}

function parseBaseline(source: string, where: string): Baseline {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (error) {
    return fail(`${where} is not valid JSON: ${(error as Error).message}`);
  }
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isRecord(json)) return fail(`${where} must be an object of files`);
  for (const [file, rules] of Object.entries(json)) {
    if (!isRecord(rules)) fail(`${where}: "${file}" must map rules to counts`);
    for (const [rule, n] of Object.entries(rules as Record<string, unknown>)) {
      if (!Number.isInteger(n) || (n as number) < 1) {
        fail(`${where}: "${file}" → "${rule}" must be a positive integer`);
      }
    }
  }
  return json as Baseline;
}

function readBaseline(root: string): Baseline {
  const file = path.join(root, BASELINE_PATH);
  if (!existsSync(file)) {
    fail(
      `${BASELINE_PATH} is missing. It records the violations that predate each rule; restore it from git.`
    );
  }
  return parseBaseline(readFileSync(file, "utf8"), BASELINE_PATH);
}

interface Base {
  /** origin/main's baseline; undefined when origin/main cannot be read. */
  baseline: Baseline | undefined;
  /** new path → old path, for files git sees renamed since origin/main. */
  renames: Map<string, string>;
}

function readBase(root: string): Base {
  const renames = new Map<string, string>();
  if (git(root, ["rev-parse", "--verify", "--quiet", BASE_REF]).status !== 0) {
    const ci = process.env.CI && process.env.CI !== "false";
    if (ci) {
      fail(
        `${BASE_REF} is missing, so the baseline cannot be compared with it. In a shallow checkout, run: git fetch --no-tags --depth=1 origin main:refs/remotes/origin/main`
      );
    }
    console.warn(
      `lint-ratchet: ${BASE_REF} is missing; renames are not followed and the baseline is not compared with it.`
    );
    return { baseline: undefined, renames };
  }
  const diff = git(root, ["diff", "--name-status", "-M", BASE_REF]);
  for (const line of diff.stdout.split("\n")) {
    const [status, from, to] = line.split("\t");
    if (status?.startsWith("R") && from && to) renames.set(to, from);
  }
  const shown = git(root, ["show", `${BASE_REF}:${BASELINE_PATH}`]);
  return {
    baseline:
      shown.status === 0
        ? parseBaseline(shown.stdout, `${BASE_REF}:${BASELINE_PATH}`)
        : {},
    renames,
  };
}

/** What `baseline` allows `file` for `rule`, following a rename. */
function allowed(
  baseline: Baseline,
  renames: ReadonlyMap<string, string>,
  file: string,
  rule: string
): number {
  const own = baseline[file];
  if (own) return own[rule] ?? 0;
  const from = renames.get(file);
  return (from && baseline[from]?.[rule]) || 0;
}

interface Rise {
  file: string;
  rule: string;
  count: number;
  allowed: number;
}

function rises(
  counts: Baseline,
  baseline: Baseline,
  renames: ReadonlyMap<string, string>,
  exempt: (rule: string) => boolean = () => false
): Rise[] {
  const found: Rise[] = [];
  for (const [file, rules] of Object.entries(counts)) {
    for (const [rule, count] of Object.entries(rules)) {
      const limit = allowed(baseline, renames, file, rule);
      if (count > limit && !exempt(rule)) {
        found.push({ file, rule, count, allowed: limit });
      }
    }
  }
  return found;
}

function falls(
  counts: Baseline,
  baseline: Baseline,
  renames: ReadonlyMap<string, string>,
  inScope: (file: string) => boolean
): number {
  const carried = new Set(
    [...renames].filter(([to]) => !baseline[to]).map(([, from]) => from)
  );
  let n = 0;
  for (const [file, rules] of Object.entries(baseline)) {
    if (!inScope(file) || carried.has(file)) continue;
    for (const [rule, limit] of Object.entries(rules)) {
      if ((counts[file]?.[rule] ?? 0) < limit) n++;
    }
  }
  return n;
}

export function serialise(counts: Baseline): string {
  const sorted: Baseline = {};
  for (const file of Object.keys(counts).sort()) {
    const rules = Object.entries(counts[file]!)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (rules.length > 0) sorted[file] = Object.fromEntries(rules);
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

const rulesIn = (baseline: Baseline) =>
  new Set(Object.values(baseline).flatMap((rules) => Object.keys(rules)));

function report(
  title: string,
  found: readonly Rise[],
  diagnostics: readonly Diagnostic[]
) {
  console.error(`\nlint-ratchet: ${title}\n`);
  for (const r of found) {
    console.error(`  ${r.file}  ${r.rule}: ${r.count}, baseline ${r.allowed}`);
    for (const d of diagnostics) {
      if (d.filename !== r.file || d.code !== r.rule) continue;
      const span = d.labels?.[0]?.span;
      const at = span ? `:${span.line}:${span.column}` : "";
      console.error(`      ${d.filename}${at}  ${d.message}`);
    }
  }
  console.error("");
}

function write(root: string, args: Args, baseline: Baseline) {
  const present = rulesIn(baseline);
  for (const rule of args.introduce) {
    if (present.has(rule)) {
      fail(
        `--introduce ${rule}: the baseline already has entries for it. --introduce only records a rule that is being switched on.`
      );
    }
  }
  const { renames } = readBase(root);
  const diagnostics = lint(root, []);
  const counts = countDiagnostics(diagnostics);
  const introduced = new Set(args.introduce);
  const found = rises(counts, baseline, renames, (r) => introduced.has(r));
  if (found.length > 0) {
    report(
      `--write only lowers counts; these would rise, so nothing was written. Fix them, or, for a rule being switched on, pass --introduce <rule>.`,
      found,
      diagnostics
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(path.join(root, BASELINE_PATH), serialise(counts));
  console.log(`lint-ratchet: wrote ${BASELINE_PATH}.`);
}

function check(root: string, args: Args, baseline: Baseline) {
  const files = args.files.map((f) => relative(root, f));
  const lintable = files.filter((f) => LINTABLE.test(f));
  if (files.length > 0 && lintable.length === 0) return;
  const base = readBase(root);
  const diagnostics = lint(root, lintable);
  const scope = new Set(lintable);
  const inScope = (file: string) => files.length === 0 || scope.has(file);
  const counts = countDiagnostics(
    diagnostics.filter((d) => inScope(d.filename))
  );
  const problems: string[] = [];

  const found = rises(counts, baseline, base.renames);
  if (found.length > 0) {
    report(
      "new lint violations (count above the baseline in lint-baseline.json). Fix them; the baseline only shrinks.",
      found,
      diagnostics
    );
    problems.push("lint");
  }

  if (files.length === 0 && base.baseline) {
    const introduced = rulesIn(base.baseline);
    const raised = rises(baseline, base.baseline, base.renames, (rule) => {
      return !introduced.has(rule);
    });
    if (raised.length > 0) {
      console.error(
        `\nlint-ratchet: ${BASELINE_PATH} raises counts compared with ${BASE_REF}. The baseline only shrinks; an entry may be added only for a rule ${BASE_REF} has no entries for (--introduce).\n`
      );
      for (const r of raised) {
        console.error(
          `  ${r.file}  ${r.rule}: ${r.count}, ${BASE_REF} has ${r.allowed}`
        );
      }
      console.error("");
      problems.push("baseline");
    }
  }

  const lower = falls(counts, baseline, base.renames, inScope);
  if (lower > 0) {
    console.log(
      `lint-ratchet: ${lower} baseline count(s) are above what the code has; node scripts/lint-ratchet.ts --write would lower them.`
    );
  }
  if (problems.length > 0) process.exitCode = 1;
}

function main() {
  const root = process.cwd();
  try {
    const args = parseArgs(process.argv.slice(2));
    const baseline = readBaseline(root);
    if (args.write) write(root, args, baseline);
    else check(root, args, baseline);
  } catch (error) {
    if (!(error instanceof RatchetError)) throw error;
    console.error(`lint-ratchet: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
