// The `network` guard's reading of one file, for scripts/check-background-jobs.ts:
// every use of an outbound network or AI client, counted by value. See that
// file's header for what counts and where.

import type { Node } from "oxc-parser";

export const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/** `"/api/…"`, `` `/api/${id}` `` or a choice between two of them. */
const isSameOriginUrl = (url: Node | undefined): boolean => {
  if (!url) return false;
  if (url.type === "ConditionalExpression") {
    return isSameOriginUrl(url.consequent) && isSameOriginUrl(url.alternate);
  }
  const head =
    url.type === "Literal" && typeof url.value === "string"
      ? url.value
      : url.type === "TemplateLiteral"
        ? (url.quasis[0]?.value.cooked ?? "")
        : "";
  // `//host` is another origin.
  return head.startsWith("/") && !head.startsWith("//");
};

/** `fetch("/api/…")`: the app calling itself, written out at the call. */
const isSameOriginFetch = (node: Node): boolean =>
  node.type === "CallExpression" &&
  isSameOriginUrl(node.arguments[0] as Node | undefined);

// The global objects `fetch` hangs off, in the browser, Node and workers.
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);

const AI_SDK_CALLS = new Set([
  "generateText",
  "streamText",
  "generateObject",
  "streamObject",
]);
const AI_SDK_AGENTS = new Set(["ToolLoopAgent", "Experimental_Agent"]);
/** A provider model's own call: `anthropic("…").doGenerate(…)`. */
const MODEL_CALLS = new Set(["doGenerate", "doStream"]);
const CLOUDINARY_CALLS = new Set(["uploader", "api"]);
const EFFECT_HTTP = new Set([
  "HttpClient",
  "FetchHttpClient",
  "NodeHttpClient",
]);
const EFFECT_HTTP_MODULES =
  /^@effect\/platform(-node|-bun|-browser)?(\/(HttpClient|FetchHttpClient|NodeHttpClient))?$/;

/** TypeScript nodes that hold a value; every other `TS*` node is a type. */
const TS_VALUE_NODES = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  "TSParameterProperty",
  "TSExportAssignment",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
]);
const TYPE_KEYS = new Set([
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
]);

/** Walks values only, with each node's parent and the key it sits under. */
function walkValues(
  node: unknown,
  visit: (node: Node, parent: Node | undefined, key: string) => void,
  parent?: Node,
  key = ""
): void {
  if (Array.isArray(node)) {
    for (const child of node) walkValues(child, visit, parent, key);
    return;
  }
  if (!isNode(node)) return;
  if (node.type.startsWith("TS") && !TS_VALUE_NODES.has(node.type)) return;
  if (node.type === "ImportDeclaration") return;
  visit(node, parent, key);
  for (const [k, value] of Object.entries(node)) {
    if (k === "parent" || TYPE_KEYS.has(k)) continue;
    if (value && typeof value === "object") walkValues(value, visit, node, k);
  }
}

/** `x.name` or `x["name"]`: the property's name, if it is written out. */
const memberName = (node: Node): string | undefined => {
  if (node.type !== "MemberExpression") return undefined;
  const p = node.property;
  if (!node.computed && p.type === "Identifier") return p.name;
  if (p.type === "Literal" && typeof p.value === "string") return p.value;
  if (p.type === "TemplateLiteral" && p.expressions.length === 0) {
    return p.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
};

/** The identifier at the root of `a.b.c`. */
const rootName = (node: Node): string | undefined => {
  let n: Node = node;
  while (n.type === "MemberExpression") n = n.object;
  return n.type === "Identifier" ? n.name : undefined;
};

/**
 * Whether an `Identifier` names a variable here (a reference or a binding),
 * rather than a property, a key or a label.
 */
const KEYED = new Set([
  "MemberExpression", // `x.fetch`: `property` names a property
  "Property", // `{ fetch: f }` names a key; `{ fetch }` binds in its value
  "MethodDefinition",
  "PropertyDefinition",
  "AccessorProperty",
]);
const LABELS = new Set([
  "LabeledStatement",
  "BreakStatement",
  "ContinueStatement",
]);
const isVariable = (parent: Node | undefined, key: string): boolean => {
  if (!parent) return true;
  if (LABELS.has(parent.type)) return false;
  if (parent.type === "ExportSpecifier") return key === "local";
  if (KEYED.has(parent.type) && (key === "key" || key === "property")) {
    return "computed" in parent && parent.computed === true;
  }
  return true;
};

/**
 * Every outbound network or AI use in `program`, by value, not by call: a
 * reference passed on (`const get = fetch`) counts as much as a call, so
 * aliasing it away does not hide it. A file never binds a name of its own
 * called `fetch` (nor destructures one out of anything): the name always means
 * the global, so it needs no scope analysis to read. The one exemption is
 * `fetch("/…")`, the app calling itself.
 */
export function findNetworkUses(program: Node): Node[] {
  // What the file imports from the AI SDK, OpenAI, Anthropic and Cloudinary,
  // by local name. A namespace or default import is the whole module.
  const aiValues = new Set<string>();
  const aiModules = new Set<string>();
  const sdkClients = new Set<string>();
  const sdkModules = new Set<string>();
  const cloudinaryNames = new Set<string>();
  const effectHttpNames = new Set<string>();
  const httpOwnerNames = new Set<string>();
  if (program.type === "Program") {
    for (const statement of program.body) {
      if (statement.type !== "ImportDeclaration") continue;
      if (statement.importKind === "type") continue;
      const from = statement.source.value;
      for (const specifier of statement.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.importKind === "type"
        ) {
          continue;
        }
        const local = specifier.local.name;
        const imported =
          specifier.type === "ImportSpecifier"
            ? specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value
            : undefined;
        if (from === "ai") {
          if (imported === undefined) aiModules.add(local);
          else if (AI_SDK_CALLS.has(imported) || AI_SDK_AGENTS.has(imported)) {
            aiValues.add(local);
          }
        }
        if (from === "openai" || from === "@anthropic-ai/sdk") {
          if (specifier.type === "ImportNamespaceSpecifier")
            sdkModules.add(local);
          else if (
            specifier.type === "ImportDefaultSpecifier" ||
            imported === "OpenAI" ||
            imported === "Anthropic" ||
            imported === "default"
          ) {
            sdkClients.add(local);
          }
        }
        if (from === "cloudinary") cloudinaryNames.add(local);
        // The fetch owner: a call through it is still an outbound call.
        if (from === "@/packages/http" && imported === "httpRequest") {
          httpOwnerNames.add(local);
        }
        // Effect's HTTP client: `HttpClient` from `@effect/platform`, or the
        // `@effect/platform/HttpClient` module itself.
        if (EFFECT_HTTP_MODULES.test(from)) {
          if (imported === undefined && from.includes("/")) {
            effectHttpNames.add(local);
          } else if (imported !== undefined && EFFECT_HTTP.has(imported)) {
            effectHttpNames.add(local);
          }
        }
      }
    }
  }

  const uses: Node[] = [];
  walkValues(program, (node, parent, key) => {
    if (node.type === "Identifier") {
      if (!isVariable(parent, key)) return;
      const name = node.name;
      const isMemberObject =
        parent?.type === "MemberExpression" && key === "object";
      if (effectHttpNames.has(name)) {
        uses.push(node);
      } else if (name === "fetch" || httpOwnerNames.has(name)) {
        const call = parent?.type === "CallExpression" && key === "callee";
        if (!(call && isSameOriginFetch(parent))) uses.push(node);
      } else if (aiValues.has(name) || sdkClients.has(name)) {
        // `OpenAI.APIError` is a class beside the client, not a call.
        if (!(sdkClients.has(name) && isMemberObject)) uses.push(node);
      } else if (
        (aiModules.has(name) ||
          sdkModules.has(name) ||
          cloudinaryNames.has(name)) &&
        !isMemberObject
      ) {
        // The whole module handed on (`const sdk = ai`), out of sight.
        uses.push(node);
      }
      return;
    }
    // `{ fetch: get } = globalThis`: a `fetch` taken out of anything.
    if (
      node.type === "Property" &&
      parent?.type === "ObjectPattern" &&
      ((node.key.type === "Identifier" &&
        !node.computed &&
        node.key.name === "fetch") ||
        (node.key.type === "Literal" && node.key.value === "fetch"))
    ) {
      if (!node.shorthand) uses.push(node);
      return;
    }
    if (node.type !== "MemberExpression") return;
    const name = memberName(node);
    if (name === undefined) return;
    const root = rootName(node.object);
    if (name === "fetch" && node.object.type === "Identifier") {
      if (!GLOBAL_OBJECTS.has(node.object.name)) return;
      const call = parent?.type === "CallExpression" && key === "callee";
      if (!(call && isSameOriginFetch(parent))) uses.push(node);
      return;
    }
    if (MODEL_CALLS.has(name)) uses.push(node);
    else if (
      node.object.type === "Identifier" &&
      aiModules.has(node.object.name) &&
      (AI_SDK_CALLS.has(name) || AI_SDK_AGENTS.has(name))
    ) {
      uses.push(node);
    } else if (
      node.object.type === "Identifier" &&
      sdkModules.has(node.object.name) &&
      (name === "OpenAI" || name === "Anthropic" || name === "default")
    ) {
      uses.push(node);
    } else if (
      root !== undefined &&
      cloudinaryNames.has(root) &&
      CLOUDINARY_CALLS.has(name)
    ) {
      uses.push(node);
    }
  });
  return uses;
}
