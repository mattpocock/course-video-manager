// Logic living in components, held to a shrink-only allowlist.
//
// docs/FRONTEND_STATE.md makes a pure reducer the home of every frontend
// decision: events in, state and declared effects out, tested by sending event
// sequences. The first two guards catch the two shapes a decision takes when
// it lives in a component instead, and the third keeps a component reading a
// reducer's store by slices:
//
// 1. `use-state` — a file with more than USE_STATE_LIMIT `useState` calls. Past
//    a handful of independent toggles, several `useState`s are one state
//    machine split across setters, and the rules that keep them consistent
//    live in event handlers no unit test can reach.
// 2. `effect-sets-state` — a file with more than EFFECT_SETS_STATE_LIMIT
//    `useEffect`/`useLayoutEffect` callbacks that reference one of the file's
//    own `useState` setters. An effect that writes state is a transition
//    hiding in a hook: it should `dispatch` an event and let the reducer decide.
// 3. `whole-store` — a `useSelector(store, selector)` or `use…Selector(selector)`
//    call whose selector returns the whole state: `(s) => s`, `(s) => ({ ...s })`
//    or a block that returns its parameter. A component subscribed to the
//    whole state re-renders on every event, which is what the effect store
//    (`apps/local/app/hooks/effect-store.ts`) exists to stop. The limit is 0
//    and it has no allowlist. `useContextSelector` is not a store's selector
//    and is out of scope.
//
// All three are per-file counts with a threshold, so a trivial toggle or a single
// subscription never trips the first two. Only `apps/local/app` is scanned, and test
// code is out of scope. Hits are matched against
// `scripts/frontend-state-allowlist.json`: a file over the threshold must have
// an entry, may not exceed its entry's count, and may not fall below it either
// (lower the count, or delete the entry once the file is back under the
// threshold), so the list only ever shrinks.
//
// Default: staged files (pre-commit). `--all`: every tracked file (CI).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync, type Node } from "oxc-parser";

export type Guard = "use-state" | "effect-sets-state" | "whole-store";
export const GUARDS: readonly Guard[] = [
  "use-state",
  "effect-sets-state",
  "whole-store",
];

/** A file is an offender when its count is ABOVE this. */
export const LIMITS: Record<Guard, number> = {
  "use-state": 4,
  "effect-sets-state": 1,
  "whole-store": 0,
};

export interface Measure {
  count: number;
  lines: number[];
}
export type Measures = Record<Guard, Measure>;

export interface AllowlistEntry {
  file: string;
  count: number;
  reason: string;
}
export type Allowlist = Partial<Record<Guard, AllowlistEntry[]>>;

export const ALLOWLIST_PATH = "scripts/frontend-state-allowlist.json";
export const DOC = "docs/FRONTEND_STATE.md";

export const isInScope = (file: string): boolean =>
  /^apps\/local\/app\/.*\.(ts|tsx)$/.test(file) &&
  !file.endsWith(".d.ts") &&
  !/\.(test|spec)\.[cm]?tsx?$/.test(file) &&
  !/(^|\/)(tests?|__tests__|test-utils|e2e)\//.test(file);

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

/** `useState(...)` or `React.useState(...)` → "useState". */
const hookName = (node: Node): string | undefined => {
  if (node.type !== "CallExpression") return undefined;
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return undefined;
};

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);

/** `useSelector`, `useCvmRecorderSelector`…, but not `useContextSelector`. */
const isStoreSelectorHook = (name: string | undefined): boolean =>
  name !== undefined &&
  /^use[A-Za-z0-9]*Selector$/.test(name) &&
  name !== "useContextSelector";

const unwrap = (node: Node): Node =>
  node.type === "ParenthesizedExpression" ? unwrap(node.expression) : node;

/** `p`, `({ ...p })` or `({ ...p, more })`: the whole of `p`. */
const isWholeOf = (node: Node, param: string): boolean => {
  const value = unwrap(node);
  if (value.type === "Identifier") return value.name === param;
  return (
    value.type === "ObjectExpression" &&
    value.properties.some(
      (property) =>
        property.type === "SpreadElement" && isWholeOf(property.argument, param)
    )
  );
};

/** A selector that returns the whole state it is given. */
const returnsWholeState = (node: Node): boolean => {
  if (
    node.type !== "ArrowFunctionExpression" &&
    node.type !== "FunctionExpression"
  ) {
    return false;
  }
  const param = node.params[0];
  if (param?.type !== "Identifier") return false;
  const body = node.body;
  if (body === null) return false;
  if (body.type !== "BlockStatement") return isWholeOf(body, param.name);
  return body.body.some(
    (statement) =>
      statement.type === "ReturnStatement" &&
      statement.argument !== null &&
      isWholeOf(statement.argument, param.name)
  );
};

/** The store selector call's selector, if it is one that reads it all. */
const selectsWholeStore = (node: Node): boolean => {
  if (node.type !== "CallExpression" || !isStoreSelectorHook(hookName(node))) {
    return false;
  }
  const selector = node.arguments.find(
    (argument) =>
      argument.type === "ArrowFunctionExpression" ||
      argument.type === "FunctionExpression"
  );
  return selector !== undefined && returnsWholeState(selector);
};

// ---------------------------------------------------------------------------
// Measuring

export function measure(file: string, source: string): Measures {
  const empty = (): Measures => ({
    "use-state": { count: 0, lines: [] },
    "effect-sets-state": { count: 0, lines: [] },
    "whole-store": { count: 0, lines: [] },
  });
  if (
    !isInScope(file) ||
    !/use(State|Effect|LayoutEffect|[A-Za-z0-9]*Selector)/.test(source)
  ) {
    return empty();
  }
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

  const result = empty();
  const setters = new Set<string>();
  const effects: Node[] = [];

  walk(program, (node) => {
    const name = hookName(node);
    if (name === "useState") {
      result["use-state"].count++;
      result["use-state"].lines.push(lineOf(node.start));
    }
    if (name && EFFECT_HOOKS.has(name)) effects.push(node);
    if (selectsWholeStore(node)) {
      result["whole-store"].count++;
      result["whole-store"].lines.push(lineOf(node.start));
    }
    if (
      node.type === "VariableDeclarator" &&
      node.init &&
      hookName(node.init) === "useState" &&
      node.id.type === "ArrayPattern"
    ) {
      const setter = node.id.elements[1];
      if (setter?.type === "Identifier") setters.add(setter.name);
    }
  });

  for (const effect of effects) {
    if (effect.type !== "CallExpression") continue;
    let writes = false;
    walk(effect.arguments[0], (n) => {
      if (n.type === "Identifier" && setters.has(n.name)) writes = true;
    });
    if (writes) {
      result["effect-sets-state"].count++;
      result["effect-sets-state"].lines.push(lineOf(effect.start));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Comparing against the allowlist

const ADVICE: Record<Guard, string> = {
  "use-state": `Fold the related state into a reducer (state + events + declared effects) and test it by sending events. See ${DOC}.`,
  "effect-sets-state": `Have the effect dispatch an event instead of setting state, so the reducer owns the transition. See ${DOC}.`,
  "whole-store": `Select only what the component shows (a field, or a selector from the reducer's file), with an isEqual if it builds an object. A component subscribed to the whole state re-renders on every event. See ${DOC}.`,
};

/**
 * Every problem with `found` against `allowlist`. `checked` is the set of
 * files that were measured: an entry for a file outside it is not judged
 * (staged mode), unless `all` is set.
 */
export function compare(
  found: ReadonlyMap<string, Measures>,
  allowlist: Allowlist,
  checked: ReadonlySet<string>,
  all: boolean
): string[] {
  const problems: string[] = [];
  for (const guard of GUARDS) {
    const limit = LIMITS[guard];
    const entries = allowlist[guard] ?? [];
    const allowed = new Map(entries.map((e) => [e.file, e.count]));

    for (const [file, measures] of found) {
      const { count, lines } = measures[guard];
      if (count <= limit) continue;
      const max = allowed.get(file);
      if (max === undefined || count > max) {
        problems.push(
          `[${guard}] ${file}: ${count}, the limit is ${limit}` +
            (max === undefined ? "" : ` and its allowlist entry says ${max}`) +
            `. ${ADVICE[guard]}\n` +
            `      lines ${lines.join(", ")}`
        );
      }
    }

    for (const entry of entries) {
      if (!all && !checked.has(entry.file)) continue;
      const count = found.get(entry.file)?.[guard].count ?? 0;
      if (count < entry.count) {
        problems.push(
          `[${guard}] ${entry.file}: the allowlist says ${entry.count}, found ${count}. ` +
            `The list only shrinks: ${count <= limit ? "delete the entry" : `lower the count to ${count}`} in ${ALLOWLIST_PATH}.`
        );
      }
    }
  }
  return problems;
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const all = process.argv.includes("--all");
  const report = process.argv.includes("--report");
  const files = execFileSync(
    "git",
    all || report
      ? ["ls-files"]
      : ["diff", "--cached", "--name-only", "--diff-filter=d"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\n")
    .filter(isInScope);

  const found = new Map<string, Measures>();
  for (const file of files) {
    const abs = path.join(root, file);
    if (!existsSync(abs)) continue;
    found.set(file, measure(file, readFileSync(abs, "utf8")));
  }

  if (report) {
    // Every file over a limit, for refreshing the allowlist or the plan.
    for (const [file, m] of found) {
      const over = GUARDS.filter((g) => m[g].count > LIMITS[g]);
      if (over.length === 0) continue;
      console.log(
        `${m["use-state"].count}\t${m["effect-sets-state"].count}\t${m["whole-store"].count}\t${file}`
      );
    }
    return;
  }

  const allowlist = JSON.parse(
    readFileSync(path.join(root, ALLOWLIST_PATH), "utf8")
  ) as Allowlist;

  const problems = compare(found, allowlist, new Set(files), all);
  if (problems.length > 0) {
    console.error("\nERROR: logic living in components:\n");
    for (const p of problems) console.error(`  ${p}\n`);
    console.error(
      `Frontend decisions live in pure reducers: read ${DOC}. The guard is scripts/check-frontend-state.ts.`
    );
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
