// Three Effect escape hatches, each held to a shrink-only allowlist.
//
// 1. `effect-run` — `Effect.run*` / `runtime.run*` outside a boundary file.
//    A runtime belongs at the edge (makeLoader/makeAction, the CLI, a daemon's
//    entry point). One anywhere else starts a detached run that loses the
//    caller's services, interruption and typed errors.
// 2. `swallowed-catch` — `catchAll(() => Effect.succeed(...) | Effect.void)`
//    (and `catchAllCause`) whose handler never looks at the error. The failure
//    vanishes with no log and no type to say it happened.
// 3. `effect-promise` — `Effect.promise(...)` in product code. A rejection
//    becomes a defect: untyped, invisible in `E`, and skipped by `catchAll`.
//    Use `Effect.tryPromise` with a tagged error.
//
// Each guard parses the file with oxc-parser, so a comment, a string or a line
// break inside the call cannot fool it. Test code is out of scope: running and
// stubbing Effects is its job. Hits are matched against
// `scripts/effect-guards-allowlist.json`, a count per file with a reason. The
// check fails if a file has MORE hits than its entry allows (a new hit), and
// also if it has FEWER (the entry is stale: lower it, or delete it at 0), so the
// list only ever shrinks.
//
// See CODING_STANDARDS.md ("Effects stay inside their boundary") and
// docs/plans/effect-codebase-health.md, Phase 3.
//
// Default: staged files (pre-commit). `--all`: every tracked file (CI).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync, type Node } from "oxc-parser";

export type Guard = "effect-run" | "swallowed-catch" | "effect-promise";
export const GUARDS: readonly Guard[] = [
  "effect-run",
  "swallowed-catch",
  "effect-promise",
];

export interface Hit {
  guard: Guard;
  line: number;
  text: string;
}

export interface AllowlistEntry {
  file: string;
  count: number;
  reason: string;
}
export type Allowlist = Partial<Record<Guard, AllowlistEntry[]>>;

export const isTestFile = (file: string): boolean =>
  /\.(test|spec)\.[cm]?tsx?$/.test(file) ||
  /(^|\/)(tests?|__tests__|test-utils|e2e)\//.test(file) ||
  /-test-(setup|harness)\.tsx?$/.test(file);

/**
 * Where a runtime is supposed to live. These are the boundary itself, not
 * legacy, so they are not in the shrink-only list.
 */
const RUN_BOUNDARIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\/)layer\.server\.ts$/, "builds the runtime"],
  [
    /^apps\/local\/app\/services\/route-action\.server\.ts$/,
    "makeLoader/makeAction: every route's run",
  ],
  [
    /^apps\/local\/app\/lib\/create-sse-response\.server\.ts$/,
    "streams an Effect into an SSE Response",
  ],
  [/^apps\/local\/app\/cli\//, "the CLI's entry point and commands"],
  [
    /^apps\/local\/app\/services\/clip-mockup-daemon\/server\.ts$/,
    "the Clip Mockup daemon's entry point",
  ],
  [
    /^apps\/local\/app\/services\/recorder-client\/live\.server\.ts$/,
    "the recorder client's entry point: it saves each recorder event as it arrives",
  ],
  [
    /^apps\/local\/app\/services\/broadcast-chat-live\.server\.ts$/,
    "the Broadcast chat's entry point: it reads the picked Broadcast's live chat from the pick to End Stream",
  ],
  [
    /^apps\/local\/sidecar\/(run-sidecar|socket)\.ts$/,
    "the Sidecar's entry point and its socket's request handler",
  ],
  [
    /^packages\/core\/services\/with-db-transaction\.server\.ts$/,
    "bridges Drizzle's async transaction callback",
  ],
  [/^apps\/remote\/(rpc|auth)\.ts$/, "the remote app's request handlers"],
  [
    /^apps\/local\/scripts\/verify-api\.ts$/,
    "verify-cvm's local apps/remote: its entry point mints the run's token",
  ],
  [
    /^apps\/local\/scripts\/storage-rename-exports\.ts$/,
    "the one-off Exported Video rename (#2104): its entry point runs the plan",
  ],
  [
    /^apps\/local\/scripts\/storage-relocate\.ts$/,
    "the one-off relocation onto a Storage Root (#2105): its entry point runs the plan",
  ],
];

export const isRunBoundary = (file: string): boolean =>
  RUN_BOUNDARIES.some(([re]) => re.test(file));

const RUN_METHODS = new Set([
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
  "runFork",
  "runCallback",
]);

const CATCH_METHODS = new Set(["catchAll", "catchAllCause"]);

// ---------------------------------------------------------------------------
// AST helpers

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (value && typeof value === "object") walk(value, visit);
  }
}

/** `x.<name>`, non-computed. */
const memberName = (node: Node | null | undefined): string | undefined =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  node.property.type === "Identifier"
    ? node.property.name
    : undefined;

/** `Effect.<name>` exactly. */
const isEffectMember = (node: Node | null | undefined, name: string) =>
  node?.type === "MemberExpression" &&
  memberName(node) === name &&
  node.object.type === "Identifier" &&
  node.object.name === "Effect";

const unwrap = (node: Node | null | undefined): Node | undefined => {
  while (
    node?.type === "TSAsExpression" ||
    node?.type === "TSSatisfiesExpression" ||
    node?.type === "TSNonNullExpression" ||
    node?.type === "ParenthesizedExpression"
  ) {
    node = node.expression;
  }
  return node ?? undefined;
};

/** `Effect.void`, `Effect.succeedNone`, `Effect.succeed(x)`, `Effect.succeedSome(x)`. */
const isSilentValue = (node: Node | undefined): boolean => {
  if (isEffectMember(node, "void") || isEffectMember(node, "succeedNone")) {
    return true;
  }
  return (
    node?.type === "CallExpression" &&
    (isEffectMember(node.callee, "succeed") ||
      isEffectMember(node.callee, "succeedSome"))
  );
};

const mentions = (node: Node, name: string): boolean => {
  let found = false;
  walk(node, (n) => {
    if (n.type === "Identifier" && n.name === name) found = true;
  });
  return found;
};

/** A handler that turns any failure into a value without looking at it. */
const isSwallowingHandler = (arg: Node | undefined): boolean => {
  const fn = unwrap(arg);
  if (
    fn?.type !== "ArrowFunctionExpression" &&
    fn?.type !== "FunctionExpression"
  ) {
    return false;
  }
  let result: Node | undefined;
  if (fn.body?.type === "BlockStatement") {
    const [only, ...rest] = fn.body.body;
    if (only?.type === "ReturnStatement" && rest.length === 0) {
      result = unwrap(only.argument);
    }
  } else {
    result = unwrap(fn.body);
  }
  if (!result || !isSilentValue(result)) return false;
  const param = fn.params[0];
  if (!param) return true;
  // `(e) => Effect.succeed({ message: e.message })` keeps the error as data.
  return param.type === "Identifier" && !mentions(result, param.name);
};

// ---------------------------------------------------------------------------
// Scanning

export function scan(file: string, source: string): Hit[] {
  if (isTestFile(file)) return [];
  const { program } = parseSync(file, source);

  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const runBoundary = isRunBoundary(file);
  const hits: Hit[] = [];
  const hit = (guard: Guard, node: Node) => {
    const line = lineOf(node.start);
    const text = source
      .slice(lineStarts[line - 1], lineStarts[line] ?? source.length)
      .trim();
    hits.push({ guard, line, text });
  };

  walk(program, (node) => {
    // 1. Any `<x>.run*` reference: a call, or passed point-free to `pipe`.
    if (!runBoundary && RUN_METHODS.has(memberName(node) ?? "")) {
      hit("effect-run", node);
    }

    if (node.type !== "CallExpression") return;
    const callee = node.callee;

    // 2. `Effect.catchAll(handler)`, and data-first `Effect.catchAll(eff, handler)`.
    const catchName =
      memberName(callee) ?? (callee.type === "Identifier" ? callee.name : "");
    if (CATCH_METHODS.has(catchName)) {
      const handler = node.arguments[node.arguments.length - 1];
      if (isSwallowingHandler(handler)) hit("swallowed-catch", node);
    }

    // 3. `Effect.promise(...)`.
    if (isEffectMember(callee, "promise")) hit("effect-promise", node);
  });

  return hits;
}

// ---------------------------------------------------------------------------
// Comparing against the allowlist

const ADVICE: Record<Guard, string> = {
  "effect-run":
    "Yield the Effect instead, or move the run to a boundary (makeLoader/makeAction, the CLI, a daemon entry point).",
  "swallowed-catch":
    "Narrow the catch (catchTag), log the failure (Effect.logWarning / tapError), or allowlist it with the reason silence is right.",
  "effect-promise":
    "Use Effect.tryPromise({ try, catch: (cause) => new FooError({ cause }) }) so a rejection lands in E.",
};

export const ALLOWLIST_PATH = "scripts/effect-guards-allowlist.json";

/**
 * Every problem with `found` against `allowlist`. `checked` is the set of
 * files that were scanned: an entry for a file outside it is not judged
 * (staged mode), unless `all` is set.
 */
export function compare(
  found: ReadonlyMap<string, readonly Hit[]>,
  allowlist: Allowlist,
  checked: ReadonlySet<string>,
  all: boolean
): string[] {
  const problems: string[] = [];
  for (const guard of GUARDS) {
    const entries = allowlist[guard] ?? [];
    const allowed = new Map(entries.map((e) => [e.file, e.count]));
    const counts = new Map<string, Hit[]>();
    for (const [file, hits] of found) {
      const mine = hits.filter((h) => h.guard === guard);
      if (mine.length > 0) counts.set(file, mine);
    }

    for (const [file, hits] of counts) {
      const limit = allowed.get(file) ?? 0;
      if (hits.length > limit) {
        problems.push(
          `[${guard}] ${file}: ${hits.length} hit(s), the allowlist allows ${limit}. ${ADVICE[guard]}\n` +
            hits.map((h) => `      ${file}:${h.line}  ${h.text}`).join("\n")
        );
      }
    }

    for (const entry of entries) {
      if (!all && !checked.has(entry.file)) continue;
      const count = counts.get(entry.file)?.length ?? 0;
      if (count < entry.count) {
        problems.push(
          `[${guard}] ${entry.file}: the allowlist says ${entry.count}, found ${count}. ` +
            `The list only shrinks: ${count === 0 ? "delete the entry" : `lower the count to ${count}`} in ${ALLOWLIST_PATH}.`
        );
      }
    }
  }
  return problems;
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const all = process.argv.includes("--all");
  const files = execFileSync(
    "git",
    all ? ["ls-files"] : ["diff", "--cached", "--name-only", "--diff-filter=d"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\n")
    .filter((f) => /\.(ts|tsx|mts)$/.test(f) && !f.endsWith(".d.ts"));

  const allowlist = JSON.parse(
    readFileSync(path.join(root, ALLOWLIST_PATH), "utf8")
  ) as Allowlist;

  const found = new Map<string, Hit[]>();
  for (const file of files) {
    const abs = path.join(root, file);
    if (!existsSync(abs)) continue;
    const hits = scan(file, readFileSync(abs, "utf8"));
    if (hits.length > 0) found.set(file, hits);
  }

  const problems = compare(found, allowlist, new Set(files), all);
  if (problems.length > 0) {
    console.error("\nERROR: Effect guard violations:\n");
    for (const p of problems) console.error(`  ${p}\n`);
    console.error(
      'See CODING_STANDARDS.md ("Effects stay inside their boundary") and scripts/check-effect-guards.ts.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
