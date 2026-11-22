import { keyName } from "./names.ts";
import type { NodeOf } from "./rule.ts";

type Member = NodeOf<"MemberExpression">;
type Expression = Member["object"];

const URLS = new Set(["DATABASE_URL", "DIRECT_DATABASE_URL"]);

const isProcessEnv = (node: Expression | null | undefined): boolean =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "Identifier" &&
  node.object.name === "process" &&
  node.property.type === "Identifier" &&
  node.property.name === "env";

/**
 * Where code touches `process.env.DATABASE_URL` or `DIRECT_DATABASE_URL`, for
 * `local/db-clients` and `local/script-db-url`. `touchesDatabaseUrl` matches a
 * member access by dot, bracket or template key; `isWrite` tells an
 * assignment or `delete` from a read; `destructuredDatabaseUrls` returns the
 * properties of a pattern destructured from `process.env` that name one.
 */
export const touchesDatabaseUrl = (node: Member): boolean => {
  if (!isProcessEnv(node.object)) return false;
  const name = keyName(node.property, node.computed);
  return name !== undefined && URLS.has(name);
};

export const isWrite = (node: Member): boolean => {
  const parent = node.parent;
  return (
    (parent.type === "AssignmentExpression" &&
      parent.operator === "=" &&
      parent.left === node) ||
    (parent.type === "UnaryExpression" && parent.operator === "delete")
  );
};

export const destructuredDatabaseUrls = (pattern: NodeOf<"ObjectPattern">) => {
  const parent = pattern.parent;
  const source =
    parent.type === "VariableDeclarator"
      ? parent.init
      : parent.type === "AssignmentExpression"
        ? parent.right
        : undefined;
  if (!isProcessEnv(source)) return [];
  return pattern.properties.filter((property) => {
    if (property.type !== "Property") return false;
    const name = keyName(property.key, property.computed);
    return name !== undefined && URLS.has(name);
  });
};
