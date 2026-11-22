import path from "node:path";
import { type Expression, memberName, unwrap } from "./names.ts";
import type { NodeOf, Rule } from "./rule.ts";

type Context = Parameters<NonNullable<Rule["create"]>>[0];
type Call = NodeOf<"CallExpression">;
type Identifier = NodeOf<"Identifier">;
type Variable = NonNullable<
  ReturnType<ReturnType<Context["sourceCode"]["getScope"]>["set"]["get"]>
>;

const FIRST = [0];
const SECOND = [1];
const BOTH = [0, 1];

const OPS = new Map([
  ["writeFile", FIRST],
  ["writeFileString", FIRST],
  ["writeFileSync", FIRST],
  ["appendFile", FIRST],
  ["appendFileSync", FIRST],
  ["remove", FIRST],
  ["unlink", FIRST],
  ["unlinkSync", FIRST],
  ["rm", FIRST],
  ["rmSync", FIRST],
  ["rmdir", FIRST],
  ["rmdirSync", FIRST],
  ["rename", BOTH],
  ["renameSync", BOTH],
  ["copyFile", SECOND],
  ["copyFileSync", SECOND],
  ["truncate", FIRST],
]);

const HELPERS = new Map([["removeBestEffort", SECOND]]);

const OWNERS = new Map([
  ["assertUnder", "services/assert-under"],
  ["assertUnderEffect", "services/assert-under"],
  ["assertUnderFinishedVideos", "services/finished-videos.server"],
  ["resolveVideoFilePath", "services/video-files"],
  ["resolveClipMockupPath", "services/clip-mockup-files"],
  ["locateClipMockupFile", "services/clip-mockup-files"],
  ["removeBestEffort", "services/remove-best-effort"],
]);

const GUARDS = new Set([
  "assertUnder",
  "assertUnderEffect",
  "assertUnderFinishedVideos",
  "resolveVideoFilePath",
  "resolveClipMockupPath",
  "locateClipMockupFile",
]);

const APP = "/apps/local/app/";

const FS_NAME = /(?:[fF]s|FS|[fF]ileSystem)$/;

const FS_MODULES = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
]);

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

const appModule = (file: string): string | undefined => {
  const posix = file
    .split(path.sep)
    .join("/")
    .replace(/\.[cm]?[jt]sx?$/, "");
  const at = posix.lastIndexOf(APP);
  return at < 0 ? undefined : posix.slice(at + APP.length);
};

const moduleOf = (context: Context, source: string) => {
  if (source.startsWith("@/")) return source.slice(2);
  if (!source.startsWith(".")) return undefined;
  return appModule(path.resolve(path.dirname(context.filename), source));
};

const ownedName = (context: Context, identifier: Identifier) => {
  const def = findVariable(context, identifier)?.defs[0];
  if (!def) return undefined;
  const found = importOf(context, identifier);
  if (found) {
    return moduleOf(context, found.source) === OWNERS.get(found.imported)
      ? found.imported
      : undefined;
  }
  if (def.type !== "FunctionName" && def.type !== "Variable") return undefined;
  return appModule(path.resolve(context.filename)) ===
    OWNERS.get(identifier.name)
    ? identifier.name
    : undefined;
};

const isEffectFileSystem = (context: Context, node: Expression) => {
  const tag = unwrap(node);
  if (tag.type !== "MemberExpression" || memberName(tag) !== "FileSystem") {
    return false;
  }
  const namespace = unwrap(tag.object);
  if (namespace.type !== "Identifier") return false;
  const found = importOf(context, namespace);
  return (
    found !== undefined &&
    found.source.startsWith("@effect/platform") &&
    (found.imported === "FileSystem" || found.imported === "*")
  );
};

const isFileSystemService = (context: Context, identifier: Identifier) => {
  const def = findVariable(context, identifier)?.defs[0];
  const declarator = def?.type === "Variable" ? def.node : undefined;
  if (declarator?.type !== "VariableDeclarator" || !declarator.init) {
    return false;
  }
  const value = unwrap(declarator.init);
  return (
    value.type === "YieldExpression" &&
    value.delegate &&
    value.argument !== null &&
    isEffectFileSystem(context, value.argument)
  );
};

const isFs = (context: Context, node: Expression): boolean => {
  const object = unwrap(node);
  if (object.type === "Identifier") {
    const imported = fsImport(context, object);
    if (imported === "*" || imported === "default" || imported === "promises") {
      return true;
    }
    return FS_NAME.test(object.name) || isFileSystemService(context, object);
  }
  if (object.type === "MemberExpression") {
    const name = memberName(object);
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
  if (callee.type === "MemberExpression" && memberName(callee) === "pipe") {
    return isGuardCall(context, callee.object);
  }
  if (callee.type === "Identifier") {
    return GUARDS.has(ownedName(context, callee) ?? "");
  }
  if (callee.type !== "MemberExpression") return false;
  const object = unwrap(callee.object);
  if (object.type !== "Identifier") return false;
  const namespace = importOf(context, object);
  const guard = memberName(callee) ?? "";
  return (
    namespace?.imported === "*" &&
    GUARDS.has(guard) &&
    moduleOf(context, namespace.source) === OWNERS.get(guard)
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

interface Write {
  op: string;
  at: number[];
}

const writeOf = (context: Context, callee: Expression): Write | undefined => {
  if (callee.type === "Identifier") {
    const helper = ownedName(context, callee);
    const helperAt = helper ? HELPERS.get(helper) : undefined;
    if (helper && helperAt) return { op: helper, at: helperAt };
    const imported = fsImport(context, callee);
    const at = imported ? OPS.get(imported) : undefined;
    return imported && at ? { op: imported, at } : undefined;
  }
  if (callee.type !== "MemberExpression") return undefined;
  const op = memberName(callee);
  const at = op ? OPS.get(op) : undefined;
  return op && at && isFs(context, callee.object) ? { op, at } : undefined;
};

export const unguardedWrite = (
  context: Context,
  call: Call
): string | undefined => {
  if (call.callee.type === "Super") return undefined;
  const write = writeOf(context, unwrap(call.callee));
  if (!write) return undefined;
  const unguarded = write.at.some(
    (i) => !isGuarded(context, call.arguments[i])
  );
  return unguarded ? write.op : undefined;
};
