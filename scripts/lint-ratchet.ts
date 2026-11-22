/**
 * The lint ratchet (`pnpm run lint`). Counts Oxlint's violations per file and
 * rule, and fails any count above `lint-baseline.json`.
 *
 *   node scripts/lint-ratchet.ts [file…]          check the repo, or only those files
 *   node scripts/lint-ratchet.ts --write          lower the baseline to match the code
 *   node scripts/lint-ratchet.ts --introduce <rule>…   record a newly switched-on rule
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  LintToolError,
  runOxlint,
  toRepoPath,
  type Diagnostic,
} from "./oxlint-json.ts";

const BASELINE_PATH = "lint-baseline.json";
const BASE_REF = "origin/main";
const LINTABLE = /\.[cm]?[jt]sx?$/;
const CORE = "packages/core";
const CORE_READER = "apps/remote/";
type Baseline = Record<string, Record<string, number>>;

const fail = (message: string): never => {
  throw new LintToolError(message);
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
  return runOxlint(
    root,
    files.length > 0 ? ["--no-error-on-unmatched-pattern", ...files] : []
  );
}

function newest(files: readonly string[]): number | undefined {
  let latest: number | undefined;
  for (const file of files) {
    latest = Math.max(latest ?? 0, statSync(file).mtimeMs);
  }
  return latest;
}

const matches = (file: string, patterns: readonly string[]) =>
  patterns.some(
    (p) => path.matchesGlob(file, p) || path.matchesGlob(file, `${p}/**`)
  );

function walk(
  root: string,
  include: readonly string[],
  exclude: readonly string[],
  dir = ""
): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const file = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (matches(file, exclude)) continue;
    if (entry.isDirectory()) found.push(...walk(root, include, exclude, file));
    else if (entry.isFile() && matches(file, include)) {
      found.push(path.join(root, file));
    }
  }
  return found;
}

function coreBuildInputs(root: string): string[] {
  const cwd = path.join(root, CORE);
  const config = path.join(cwd, "tsconfig.build.json");
  let json: unknown;
  try {
    json = JSON.parse(
      readFileSync(config, "utf8").replace(
        /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
        (_, string: string | undefined) => string ?? ""
      )
    );
  } catch (error) {
    return fail(`cannot read ${CORE}/tsconfig.build.json: ${String(error)}`);
  }
  const strings = (key: string): string[] | undefined => {
    const value: unknown =
      typeof json === "object" && json !== null
        ? Object.getOwnPropertyDescriptor(json, key)?.value
        : undefined;
    if (!Array.isArray(value)) return undefined;
    const items: unknown[] = value;
    const found = items.filter((s): s is string => typeof s === "string");
    return found.length === items.length ? found : undefined;
  };
  const include = strings("include");
  const exclude = strings("exclude");
  if (!include || !exclude) {
    return fail(`${CORE}/tsconfig.build.json must list include and exclude`);
  }
  return walk(cwd, include, exclude).filter((file) =>
    /\.([cm]?tsx?|json)$/.test(file)
  );
}

function requireCoreBuild(root: string, files: readonly string[]) {
  const reads =
    files.length === 0
      ? existsSync(path.join(root, CORE_READER))
      : files.some((f) => f.startsWith(CORE_READER));
  if (!reads) return;
  const dist = path.join(root, CORE, "dist");
  const built = existsSync(dist) ? newest(walk(dist, ["**/*"], [])) : undefined;
  const edited = newest(coreBuildInputs(root));
  if (built !== undefined && built >= (edited ?? 0)) return;
  fail(
    `@cvm/core is not built, or its build is older than its sources, so its imports in ${CORE_READER} would type as errors and the type-aware rules would count spurious violations. Build it first: pnpm --filter @cvm/core build`
  );
}

function countDiagnostics(diagnostics: readonly Diagnostic[]): Baseline {
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
  baseline: Baseline | undefined;
  renames: Map<string, string>;
}

function readBase(root: string): Base {
  const renames = new Map<string, string>();
  if (git(root, ["rev-parse", "--verify", "--quiet", BASE_REF]).status !== 0) {
    if (process.env.CI && process.env.CI !== "false") {
      fail(
        `${BASE_REF} is missing, so the baseline cannot be compared with it. In a shallow checkout, run: git fetch --no-tags --depth=1 origin main:refs/remotes/origin/main`
      );
    }
    console.warn(
      `lint-ratchet: ${BASE_REF} is missing; renames are not followed and the baseline is not compared with it.`
    );
    return { baseline: undefined, renames };
  }
  const diff = gitOrFail(root, [
    "diff",
    "--name-status",
    "-M",
    forkPoint(root),
  ]);
  for (const line of diff.split("\n")) {
    const [status, from, to] = line.split("\t");
    if (status?.startsWith("R") && from && to) renames.set(to, from);
  }
  const listed = gitOrFail(root, [
    "ls-tree",
    "--name-only",
    BASE_REF,
    "--",
    BASELINE_PATH,
  ]);
  const baseline =
    listed.trim() === ""
      ? {}
      : parseBaseline(
          gitOrFail(root, ["show", `${BASE_REF}:${BASELINE_PATH}`]),
          `${BASE_REF}:${BASELINE_PATH}`
        );
  return { baseline, renames };
}

function forkPoint(root: string): string {
  const mergeBase = git(root, ["merge-base", BASE_REF, "HEAD"]);
  if (mergeBase.status === 0) return mergeBase.stdout.trim();
  const shallow = gitOrFail(root, ["rev-parse", "--is-shallow-repository"]);
  if (shallow.trim() === "true") return BASE_REF;
  return fail(
    `git merge-base ${BASE_REF} HEAD failed: ${mergeBase.stderr.trim()}`
  );
}

function gitOrFail(root: string, args: string[]): string {
  const run = git(root, args);
  if (run.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${(run.stderr ?? "").trim()}`);
  }
  return run.stdout;
}

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

function serialise(counts: Baseline): string {
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
      if (d.help) console.error(`          help: ${d.help}`);
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
  requireCoreBuild(root, []);
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
  const files = args.files.map((f) => toRepoPath(root, f));
  const lintable = files.filter((f) => LINTABLE.test(f));
  if (files.length > 0 && lintable.length === 0) return;
  requireCoreBuild(root, lintable);
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
    if (!(error instanceof LintToolError)) throw error;
    console.error(`lint-ratchet: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
