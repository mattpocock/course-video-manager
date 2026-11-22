import { calleeName, unwrap } from "./names.ts";
import type { NodeOf } from "./rule.ts";

type Cast = NodeOf<"TSAsExpression"> | NodeOf<"TSTypeAssertion">;
type Node = Cast | Cast["parent"];

const isUnknownCast = (node: Cast["expression"]): boolean => {
  const inner = unwrap(node);
  return (
    inner.type === "TSAsExpression" &&
    inner.typeAnnotation.type === "TSUnknownKeyword"
  );
};

const inResponseArguments = (node: Node): boolean => {
  const parent = node.parent;
  if (parent === null) return false;
  if (
    parent.type === "NewExpression" &&
    parent.arguments.some((argument) => argument === node) &&
    calleeName(parent.callee) === "Response"
  ) {
    return true;
  }
  return inResponseArguments(parent);
};

/**
 * Whether `node` is the cast `local/response-body` bans: an `as any` (or
 * `<any>`) or an `as unknown as`, anywhere inside the arguments of
 * `new Response(...)`.
 */
export const isResponseBodyCast = (node: Cast): boolean =>
  (node.typeAnnotation.type === "TSAnyKeyword" ||
    (node.type === "TSAsExpression" && isUnknownCast(node.expression))) &&
  inResponseArguments(node);
