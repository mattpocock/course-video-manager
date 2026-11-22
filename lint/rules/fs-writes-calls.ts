import type { NodeOf, Rule } from "./rule.ts";

type Context = Parameters<NonNullable<Rule["create"]>>[0];
type Call = NodeOf<"CallExpression">;
type Member = NodeOf<"MemberExpression">;
type Expression = Member["object"];
type Identifier = NodeOf<"Identifier">;
type Variable = NonNullable<
  ReturnType<ReturnType<Context["sourceCode"]["getScope"]>["set"]["get"]>
>;

const OPS = new Set([
  "writeFile",
  "writeFileString",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "remove",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "rename",
  "renameSync",
  "copyFile",
  "copyFileSync",
  "truncate",
]);

const GUARDS = new Set([
  "assertUnder",
  "assertUnderEffect",
  "assertUnderFinishedVideos",
  "resolveVideoFilePath",
  "resolveClipMockupPath",
  "locateClipMockupFile",
]);

const FS_NAME = /(?:[fF]s|FS|fsvc|[fF]ileSystem)$/;

const FS_MODULES = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
]);

const unwrap = (node: Expression): Expression => {
  if (node.type === "ChainExpression") return unwrap(node.expression);
  if (node.type === "ParenthesizedExpression") return unwrap(node.expression);
  return node;
};

const keyName = (member: Member): string | undefined => {
  const key = member.property;
  if (!member.computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  if (key.type === "TemplateLiteral" && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
};

const findVariable = (
  context: Context,
  identifier: Identifier
): Variable | undefined => {
  for (
    let scope: ReturnType<Context["sourceCode"]["getScope"]> | null =
      context.sourceCode.getScope(identifier);
    scope;
    scope = scope.upper
  ) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
  }
  return undefined;
};

interface Imported {
  source: string;
  imported: string;
}

const importOf = (
  context: Context,
  identifier: Identifier
): Imported | undefined => {
  const def = findVariable(context, identifier)?.defs[0];
  const declaration = def?.parent;
  if (
    def?.type !== "ImportBinding" ||
    declaration?.type !== "ImportDeclaration"
  ) {
    return undefined;
  }
  const source = declaration.source.value;
  const node = def.node;
  if (node.type === "ImportNamespaceSpecifier")
    return { source, imported: "*" };
  if (node.type === "ImportDefaultSpecifier") {
    return { source, imported: "default" };
  }
  if (node.type !== "ImportSpecifier") return undefined;
  const imported = node.imported;
  return {
    source,
    imported: imported.type === "Literal" ? imported.value : imported.name,
  };
};

const fsImport = (context: Context, identifier: Identifier) => {
  const found = importOf(context, identifier);
  return found && FS_MODULES.has(found.source) ? found.imported : undefined;
};

const nameOf = (context: Context, identifier: Identifier) =>
  importOf(context, identifier)?.imported ?? identifier.name;

const isFs = (context: Context, node: Expression): boolean => {
  const object = unwrap(node);
  if (object.type === "Identifier") {
    const imported = fsImport(context, object);
    if (imported === "*" || imported === "default" || imported === "promises") {
      return true;
    }
    return FS_NAME.test(object.name);
  }
  if (object.type === "MemberExpression") {
    const name = keyName(object);
    if (name === "promises" && isFs(context, object.object)) return true;
    return name !== undefined && FS_NAME.test(name);
  }
  return false;
};

const isGuardCall = (context: Context, node: Expression): boolean => {
  let call = unwrap(node);
  if (call.type === "YieldExpression" && call.delegate && call.argument) {
    call = unwrap(call.argument);
  }
  if (call.type !== "CallExpression") return false;
  const callee = unwrap(call.callee);
  if (callee.type === "MemberExpression" && keyName(callee) === "pipe") {
    return isGuardCall(context, callee.object);
  }
  if (callee.type === "Identifier") return GUARDS.has(nameOf(context, callee));
  if (callee.type !== "MemberExpression") return false;
  const object = unwrap(callee.object);
  return (
    object.type === "Identifier" &&
    importOf(context, object)?.imported === "*" &&
    GUARDS.has(keyName(callee) ?? "")
  );
};

const isGuardedVariable = (context: Context, identifier: Identifier) => {
  const variable = findVariable(context, identifier);
  const def = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  const declarator = def?.type === "Variable" ? def.node : undefined;
  if (
    declarator?.type !== "VariableDeclarator" ||
    declarator.id.type !== "Identifier" ||
    !declarator.init
  ) {
    return false;
  }
  if (variable?.references.some((ref) => ref.isWrite() && !ref.init)) {
    return false;
  }
  return isGuardCall(context, declarator.init);
};

const isGuarded = (
  context: Context,
  arg: Call["arguments"][number] | undefined
) => {
  if (!arg || arg.type === "SpreadElement") return false;
  const node = unwrap(arg);
  if (node.type === "Identifier") return isGuardedVariable(context, node);
  return isGuardCall(context, node);
};

const writeOf = (context: Context, callee: Expression): string | undefined => {
  if (callee.type === "Identifier") {
    if (nameOf(context, callee) === "removeBestEffort")
      return "removeBestEffort";
    const imported = fsImport(context, callee);
    return imported && OPS.has(imported) ? imported : undefined;
  }
  if (callee.type !== "MemberExpression") return undefined;
  const op = keyName(callee);
  return op && OPS.has(op) && isFs(context, callee.object) ? op : undefined;
};

const destinations = (op: string, args: Call["arguments"]) => {
  if (op === "removeBestEffort") return [args[1]];
  if (op.startsWith("copyFile")) return [args[1]];
  if (op.startsWith("rename")) return [args[0], args[1]];
  return [args[0]];
};

export const unguardedWrite = (
  context: Context,
  call: Call
): string | undefined => {
  if (call.callee.type === "Super") return undefined;
  const op = writeOf(context, unwrap(call.callee));
  if (!op) return undefined;
  const unguarded = destinations(op, call.arguments).some(
    (arg) => !isGuarded(context, arg)
  );
  return unguarded ? op : undefined;
};
