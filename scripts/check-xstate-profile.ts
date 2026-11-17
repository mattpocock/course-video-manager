// The strict XState profile (docs/XSTATE.md): ONE way to write each part of a
// machine, so an agent never has to choose. xstate@6.0.0-beta.3 and
// @xstate/react@7.0.0-beta.0. The banned imports are `no-restricted-imports`
// in .oxlintrc.json; this guard holds the shapes a lint rule cannot see.
//
// Machine rules, for `*-machine.ts` files under apps/local/app:
//
// 1. `machine-file`     — `setup` is imported only in a `*-machine.ts` file,
//                         and a machine file imports no React.
// 2. `setup-shape`      — `setup({ schemas, actions, states })`, nothing else.
// 3. `state-shape`      — the machine is `{ id, context, initial, on, states }`
//                         and each state `{ on, after, description }`.
// 4. `flat-states`      — no state has child states, no target is a path or
//                         an `#id`. A workaround for statelyai/xstate#5921:
//                         beta.3 skips a context refinement on a state
//                         entered through its parent. REMOVE THIS RULE once
//                         #5921 is fixed and the pinned beta has the fix.
// 5. `transition-function` — every `on`/`after` handler is a transition
//                         function (or a reference to one), never an object,
//                         a string or an array.
// 6. `literal-target`   — `target` is a string literal, so tsc checks it
//                         against the states and their contracts.
// 7. `named-effects`    — an effect is `enq(actions.x, params)` and the one
//                         other `enq` call is `enq.raise(event)`.
//
// Binding rule, for every other file under apps/local/app:
//
// 8. `binding`          — `useActorRef` only in a `use-*.ts` hook, which is
//                         also the only place a machine is `.provide()`d;
//                         `useSelector(actor, selector)` with no compare.
//
// Test code is out of scope: tests drive machines with `transition()`, which
// `no-restricted-imports` leaves them as the only way. There is no allowlist:
// the profile is new, so every machine meets it.
//
// Default: staged files (pre-commit). `--all`: every tracked file (CI).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync, type Node, type ObjectProperty } from "oxc-parser";

export type Rule =
  | "machine-file"
  | "setup-shape"
  | "state-shape"
  | "flat-states"
  | "transition-function"
  | "literal-target"
  | "named-effects"
  | "binding";

export const RULES: readonly Rule[] = [
  "machine-file",
  "setup-shape",
  "state-shape",
  "flat-states",
  "transition-function",
  "literal-target",
  "named-effects",
  "binding",
];

export interface Hit {
  rule: Rule;
  line: number;
  message: string;
}

export const DOC = "docs/XSTATE.md";

export const isInScope = (file: string): boolean =>
  /^apps\/local\/app\/.*\.(ts|tsx)$/.test(file) &&
  !file.endsWith(".d.ts") &&
  !/\.(test|spec)\.[cm]?tsx?$/.test(file) &&
  !/(^|\/)(tests?|__tests__|test-utils|e2e)\//.test(file) &&
  !/-test-(setup|harness)\.tsx?$/.test(file);

export const isMachineFile = (file: string): boolean =>
  file.endsWith("-machine.ts");

export const isHookFile = (file: string): boolean =>
  /(^|\/)use-[^/]+\.tsx?$/.test(file);

const SETUP_KEYS = new Set(["schemas", "actions", "states"]);
const SCHEMA_KEYS = new Set(["input", "context", "events", "internalEvents"]);
const MACHINE_KEYS = new Set(["id", "context", "initial", "on", "states"]);
const STATE_KEYS = new Set(["on", "after", "description"]);
const ENQ_METHODS = new Set(["raise"]);

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

type ObjectNode = Extract<Node, { type: "ObjectExpression" }>;
type PropertyNode = ObjectProperty;

/** A property's name, for `a`, `"a"` and `["a"]`; undefined if computed. */
const keyOf = (p: PropertyNode): string | undefined => {
  const key = p.key;
  if (key.type === "Identifier" && !p.computed) return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
};

const propertiesOf = (o: ObjectNode): PropertyNode[] =>
  o.properties.filter((p): p is PropertyNode => p.type === "Property");

const prop = (o: ObjectNode, name: string): Node | undefined =>
  propertiesOf(o).find((p) => keyOf(p) === name)?.value;

const asObject = (n: Node | undefined): ObjectNode | undefined =>
  n?.type === "ObjectExpression" ? n : undefined;

/** `f(...)` or `x.f(...)` → "f". */
const calleeName = (node: Node): string | undefined => {
  if (node.type !== "CallExpression") return undefined;
  const c = node.callee;
  if (c.type === "Identifier") return c.name;
  if (
    c.type === "MemberExpression" &&
    !c.computed &&
    c.property.type === "Identifier"
  )
    return c.property.name;
  return undefined;
};

const isFunction = (n: Node) =>
  n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression";

/** A transition handler: a function, a named one, or a factory's result. */
const isHandler = (n: Node) =>
  isFunction(n) || n.type === "Identifier" || n.type === "CallExpression";

/** `actions.x` or `actions["x"]`. */
const isNamedAction = (n: Node) =>
  n.type === "MemberExpression" &&
  n.object.type === "Identifier" &&
  n.object.name === "actions";

// ---------------------------------------------------------------------------
// Checking

export function check(file: string, source: string): Hit[] {
  if (!isInScope(file) || !/xstate/.test(source)) return [];
  const { program } = parseSync(file, source);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") lineStarts.push(i + 1);
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
  const hits: Hit[] = [];
  const ctx: Ctx = {
    file,
    machine: isMachineFile(file),
    hooks: new Map(),
    provides: [],
    callsUseActorRef: false,
    hit: (rule, node, message) =>
      hits.push({ rule, line: lineOf(node.start), message }),
  };
  walk(program, (node) => {
    if (node.type === "ImportDeclaration") visitImport(node, ctx);
    else if (node.type === "CallExpression") visitCall(node, ctx);
    else if (ctx.machine && node.type === "ObjectExpression")
      for (const p of propertiesOf(node)) visitTarget(p, ctx.hit);
  });
  if (!isHookFile(file) || !ctx.callsUseActorRef)
    for (const node of ctx.provides)
      ctx.hit(
        "binding",
        node,
        "Provide a machine's implementations where it runs: the `use-*.ts` hook that calls `useActorRef`."
      );
  return hits;
}

type HitFn = (rule: Rule, node: Node, message: string) => void;
type Ctx = {
  file: string;
  machine: boolean;
  /** Local names of the hooks imported from @xstate/react. */
  hooks: Map<string, string>;
  provides: Node[];
  callsUseActorRef: boolean;
  hit: HitFn;
};
type ImportNode = Extract<Node, { type: "ImportDeclaration" }>;
type CallNode = Extract<Node, { type: "CallExpression" }>;

const importedNames = (node: ImportNode) =>
  node.specifiers.flatMap((s) =>
    s.type === "ImportSpecifier" && s.imported.type === "Identifier"
      ? [{ local: s.local.name, imported: s.imported.name }]
      : []
  );

function visitImport(node: ImportNode, ctx: Ctx) {
  const from = node.source.value;
  const names = importedNames(node);
  if (from === "@xstate/react")
    for (const n of names) ctx.hooks.set(n.local, n.imported);
  if (
    from === "xstate" &&
    !ctx.machine &&
    names.some((n) => n.imported === "setup")
  )
    ctx.hit(
      "machine-file",
      node,
      "A machine lives in its own `*-machine.ts` file: import `setup` there only."
    );
  if (ctx.machine && (from === "react" || from === "@xstate/react"))
    ctx.hit(
      "machine-file",
      node,
      "A machine file imports no React: bind the machine in a `use-*.ts` hook."
    );
}

function visitCall(node: CallNode, ctx: Ctx) {
  visitBinding(node, ctx);
  if (!ctx.machine) return;
  const name = calleeName(node);
  const arg = node.arguments[0];
  if (name === "setup" && arg?.type === "ObjectExpression")
    checkSetup(arg, ctx.hit);
  if (name === "createMachine" && arg?.type === "ObjectExpression")
    checkMachine(arg, ctx.hit);
  visitEnq(node, ctx.hit);
}

function visitBinding(node: CallNode, ctx: Ctx) {
  const callee = node.callee;
  const hook =
    callee.type === "Identifier" ? ctx.hooks.get(callee.name) : undefined;
  if (hook === "useActorRef") {
    ctx.callsUseActorRef = true;
    if (!isHookFile(ctx.file))
      ctx.hit(
        "binding",
        node,
        "`useActorRef` runs a machine in one place: a `use-*.ts` hook."
      );
  }
  if (hook === "useSelector" && node.arguments.length !== 2)
    ctx.hit(
      "binding",
      node,
      "`useSelector(actor, selector)`, no compare: select a primitive or a slice that keeps its identity."
    );
  if (
    calleeName(node) === "provide" &&
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name.endsWith("Machine")
  )
    ctx.provides.push(node);
}

function visitEnq(node: CallNode, hit: HitFn) {
  const callee = node.callee;
  const arg = node.arguments[0];
  if (
    callee.type === "Identifier" &&
    callee.name === "enq" &&
    (!arg || !isNamedAction(arg))
  )
    hit(
      "named-effects",
      node,
      "An effect is a named action with its data: `enq(actions.name, params)`, never an inline function."
    );
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "enq" &&
    callee.property.type === "Identifier" &&
    (!ENQ_METHODS.has(callee.property.name) || node.arguments.length !== 1)
  )
    hit(
      "named-effects",
      node,
      `\`enq.${callee.property.name}\` is not in the profile: use \`enq(actions.name, params)\`, or \`enq.raise(event)\` with no options.`
    );
}

function visitTarget(node: PropertyNode, hit: HitFn) {
  if (keyOf(node) !== "target") return;
  const v = node.value;
  if (v.type !== "Literal" || typeof v.value !== "string")
    hit(
      "literal-target",
      node,
      "`target` is a string literal, so tsc checks it against the states and their contracts."
    );
  else if (/[.#]/.test(v.value))
    hit(
      "flat-states",
      node,
      `Target "${v.value}" is a path or an #id: target a sibling state by name (#5921 workaround; remove once statelyai/xstate#5921 is fixed).`
    );
}

/** Every key of `o` outside `allowed`, as a hit. */
function checkKeys(
  o: ObjectNode | undefined,
  allowed: ReadonlySet<string>,
  rule: Rule,
  message: (key: string) => string,
  hit: HitFn
) {
  for (const p of o ? propertiesOf(o) : []) {
    const key = keyOf(p) ?? "…";
    if (!allowed.has(key)) hit(rule, p, message(key));
  }
}

const CONTRACT_KEYS = new Set(["schemas", "states"]);
const CONTRACT_SCHEMA_KEYS = new Set(["context"]);

function checkSetup(config: ObjectNode, hit: HitFn) {
  checkKeys(
    config,
    SETUP_KEYS,
    "setup-shape",
    (k) =>
      `\`setup({ ${k} })\` is not in the profile: setup takes \`schemas\`, \`actions\` and \`states\`.`,
    hit
  );
  checkKeys(
    asObject(prop(config, "schemas")),
    SCHEMA_KEYS,
    "setup-shape",
    (k) =>
      `\`schemas.${k}\` is not in the profile: declare \`input\`, \`context\`, \`events\` and \`internalEvents\`.`,
    hit
  );
  const states = asObject(prop(config, "states"));
  for (const s of states ? propertiesOf(states) : []) {
    const contract = asObject(s.value);
    if (!contract) continue;
    checkKeys(
      contract,
      CONTRACT_KEYS,
      "setup-shape",
      (k) =>
        `A state contract declares only \`schemas.context\`, not \`${k}\`.`,
      hit
    );
    const nested = propertiesOf(contract).find((p) => keyOf(p) === "states");
    if (nested)
      hit(
        "flat-states",
        nested,
        "A state contract has no child states (#5921 workaround; remove once statelyai/xstate#5921 is fixed)."
      );
    checkKeys(
      asObject(prop(contract, "schemas")),
      CONTRACT_SCHEMA_KEYS,
      "setup-shape",
      (k) =>
        `A state contract declares only \`schemas.context\`, not \`schemas.${k}\`.`,
      hit
    );
  }
}

function checkHandlers(map: ObjectNode | undefined, hit: HitFn) {
  for (const p of map ? propertiesOf(map) : [])
    if (!isHandler(p.value))
      hit(
        "transition-function",
        p,
        `Handler "${keyOf(p) ?? "…"}" is a transition function \`({ context, event }, enq) => …\`, not an object, string or array.`
      );
}

function checkMachine(config: ObjectNode, hit: HitFn) {
  for (const p of propertiesOf(config)) {
    const key = keyOf(p);
    if (!key || !MACHINE_KEYS.has(key))
      hit(
        "state-shape",
        p,
        `The machine takes \`id\`, \`context\`, \`initial\`, \`on\` and \`states\`, not \`${key ?? "…"}\`.`
      );
  }
  checkHandlers(asObject(prop(config, "on")), hit);
  const states = asObject(prop(config, "states"));
  for (const s of states ? propertiesOf(states) : []) {
    const state = asObject(s.value);
    if (!state) continue;
    for (const p of propertiesOf(state)) {
      const key = keyOf(p);
      if (key === "states")
        hit(
          "flat-states",
          p,
          `State "${keyOf(s) ?? "…"}" has child states: keep the machine flat (#5921 workaround; remove once statelyai/xstate#5921 is fixed).`
        );
      else if (!key || !STATE_KEYS.has(key))
        hit(
          "state-shape",
          p,
          `A state takes \`on\`, \`after\` and \`description\`, not \`${key ?? "…"}\`: effects belong to the transition that causes them.`
        );
    }
    checkHandlers(asObject(prop(state, "on")), hit);
    checkHandlers(asObject(prop(state, "after")), hit);
  }
}

// ---------------------------------------------------------------------------

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const all = process.argv.includes("--all");
  const files = execFileSync(
    "git",
    all ? ["ls-files"] : ["diff", "--cached", "--name-only", "--diff-filter=d"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\n")
    .filter(isInScope);
  const problems: string[] = [];
  for (const file of files) {
    const abs = path.join(root, file);
    if (!existsSync(abs)) continue;
    for (const h of check(file, readFileSync(abs, "utf8")))
      problems.push(`[${h.rule}] ${file}:${h.line} ${h.message}`);
  }
  if (problems.length > 0) {
    console.error("\nERROR: outside the strict XState profile:\n");
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      `\nThe profile is ${DOC}. The guard is scripts/check-xstate-profile.ts.`
    );
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
