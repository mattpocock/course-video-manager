// Logic living in components, and components reading a whole store.
//
// docs/FRONTEND_STATE.md makes a pure reducer the home of every frontend
// decision (events in, state and declared effects out, tested by sending
// event sequences), held in an effect store that components read by slices.
// Three per-file counts, over `apps/local/app` less test code:
//
// 1. `use-state`: more than 4 `useState` calls. Past a handful of
//    independent toggles they are one state machine split across setters.
// 2. `effect-sets-state`: more than 1 `useEffect`/`useLayoutEffect` that
//    references one of the file's own `useState` setters. An effect that
//    writes state is a transition hiding in a hook; it should dispatch.
// 3. `whole-store`: any read of a store's whole state, which re-renders the
//    component on every event:
//    - a store selector that returns its parameter: `(s) => s`,
//      `(s) => ({ ...s })`, `(s) => Object.assign({}, s)`, a block that
//      returns it, through `as`/`satisfies`/`!`, or a function of the same
//      file passed by name. The selector is the hook's selector argument
//      (`useSelector(store, selector, isEqual)`, `useFooSelector(selector,
//      isEqual)`), so an `isEqual` is never judged. `useContextSelector`
//      is out of scope.
//    - `useSyncExternalStore(subscribe, store.getSnapshot)` (or a function
//      returning `store.getSnapshot()`) anywhere but `hooks/effect-store.ts`.
//      A `useSyncExternalStore` that reads its own narrow value, such as
//      the Live Timer's clock tick, passes.
//
// `use-state` and `effect-sets-state` are held to
// `scripts/frontend-state-allowlist.json`, which only shrinks: a file over
// the limit must have an entry, may not exceed it, and may not fall below it
// (lower the count, or delete the entry once the file is back under).
// `whole-store` is a hard 0: it takes no entries, and an entry for it fails.
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

/**
 * Where a store selector hook takes its selector: `useSelector(store,
 * selector, isEqual)`, or a surface's `useFooSelector(selector, isEqual)`.
 * Undefined for any other call, `useContextSelector` included.
 */
const selectorPosition = (name: string | undefined): number | undefined => {
  if (name === "useSelector") return 1;
  if (name === undefined || name === "useContextSelector") return undefined;
  return /^use[A-Za-z0-9]+Selector$/.test(name) ? 0 : undefined;
};

/** The one file allowed to call `useSyncExternalStore`. */
export const STORE_MODULE = "apps/local/app/hooks/effect-store.ts";

const WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/** `(x)`, `x as T`, `x satisfies T`, `x!` and `<T>x` are all `x`. */
const unwrap = (node: Node): Node =>
  WRAPPERS.has(node.type) && "expression" in node && isNode(node.expression)
    ? unwrap(node.expression)
    : node;

/** `Object.assign(…)`. */
const isObjectAssign = (
  node: Node
): node is Node & { type: "CallExpression" } =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "Object" &&
  node.callee.property.type === "Identifier" &&
  node.callee.property.name === "assign";

/**
 * `p`, `({ ...p })`, `({ ...p, more })` or `Object.assign({}, p)`: the whole
 * of `p`.
 */
const isWholeOf = (node: Node, param: string): boolean => {
  const value = unwrap(node);
  if (value.type === "Identifier") return value.name === param;
  if (isObjectAssign(value)) {
    return value.arguments.some(
      (argument) => isNode(argument) && isWholeOf(argument, param)
    );
  }
  return (
    value.type === "ObjectExpression" &&
    value.properties.some(
      (property) =>
        property.type === "SpreadElement" && isWholeOf(property.argument, param)
    )
  );
};

/** A function that returns the whole state it is given. */
const returnsWholeState = (node: Node): boolean => {
  if (
    node.type !== "ArrowFunctionExpression" &&
    node.type !== "FunctionExpression" &&
    node.type !== "FunctionDeclaration"
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

/**
 * The functions a file declares by name (`function f`, `const f = () => …`),
 * so a selector passed as `useSelector(store, everything)` is judged too.
 */
const declaredFunctions = (program: Node): Map<string, Node> => {
  const functions = new Map<string, Node>();
  walk(program, (node) => {
    if (node.type === "FunctionDeclaration" && node.id) {
      functions.set(node.id.name, node);
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init
    ) {
      functions.set(node.id.name, unwrap(node.init));
    }
  });
  return functions;
};

/** A store selector call whose selector reads the whole state. */
const selectsWholeStore = (
  node: Node,
  functions: ReadonlyMap<string, Node>
): boolean => {
  if (node.type !== "CallExpression") return false;
  const position = selectorPosition(hookName(node));
  if (position === undefined) return false;
  const argument = node.arguments[position];
  if (!isNode(argument)) return false;
  const selector = unwrap(argument);
  const resolved =
    selector.type === "Identifier" ? functions.get(selector.name) : selector;
  return resolved !== undefined && returnsWholeState(resolved);
};

/** `x.getSnapshot`, or a function returning `x.getSnapshot()`. */
const isGetSnapshot = (node: Node): boolean => {
  const value = unwrap(node);
  if (
    value.type === "MemberExpression" &&
    !value.computed &&
    value.property.type === "Identifier"
  ) {
    return value.property.name === "getSnapshot";
  }
  if (value.type === "CallExpression") return isGetSnapshot(value.callee);
  if (value.type !== "ArrowFunctionExpression") return false;
  if (value.body.type !== "BlockStatement") return isGetSnapshot(value.body);
  return value.body.body.some(
    (statement) =>
      statement.type === "ReturnStatement" &&
      statement.argument !== null &&
      isGetSnapshot(statement.argument)
  );
};

/**
 * `useSyncExternalStore(subscribe, store.getSnapshot)` outside the store
 * module: a store's whole snapshot, read past `useSelector`. A
 * `useSyncExternalStore` that reads its own narrow value (a clock tick, a
 * flag) is not a store read and passes.
 */
const readsStoreDirectly = (file: string, node: Node): boolean => {
  if (file === STORE_MODULE || node.type !== "CallExpression") return false;
  if (hookName(node) !== "useSyncExternalStore") return false;
  return node.arguments
    .slice(1)
    .some((argument) => isNode(argument) && isGetSnapshot(argument));
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
    !/use(State|Effect|LayoutEffect|SyncExternalStore|[A-Za-z0-9]*Selector)/.test(
      source
    )
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
  const functions = declaredFunctions(program);

  walk(program, (node) => {
    const name = hookName(node);
    if (name === "useState") {
      result["use-state"].count++;
      result["use-state"].lines.push(lineOf(node.start));
    }
    if (name && EFFECT_HOOKS.has(name)) effects.push(node);
    if (selectsWholeStore(node, functions) || readsStoreDirectly(file, node)) {
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
  "whole-store": `Select only what the component shows (a field, or a selector from the reducer's file), with an isEqual if it builds an object, through useSelector (never useSyncExternalStore directly). A component subscribed to the whole state re-renders on every event. See ${DOC}.`,
};

/** Guards that take no allowlist: every hit fails, and every entry too. */
const NO_ALLOWLIST: ReadonlySet<Guard> = new Set(["whole-store"]);

/**
 * The entries `guard` is judged against, and a problem for each entry a
 * no-allowlist guard was given anyway.
 */
const entriesFor = (
  guard: Guard,
  allowlist: Allowlist
): { entries: AllowlistEntry[]; refused: string[] } => {
  const listed = allowlist[guard] ?? [];
  if (!NO_ALLOWLIST.has(guard)) return { entries: listed, refused: [] };
  return {
    entries: [],
    refused: listed.map(
      (entry) =>
        `[${guard}] ${entry.file}: ${ALLOWLIST_PATH} may not list ${guard}; it has no allowlist. Delete the entry and fix the file.`
    ),
  };
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
    const { entries, refused } = entriesFor(guard, allowlist);
    problems.push(...refused);
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
