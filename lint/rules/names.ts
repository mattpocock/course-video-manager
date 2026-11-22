import type { NodeOf } from "./rule.ts";

type Member = NodeOf<"MemberExpression">;
type Expression = Member["object"];

/**
 * The names the local rules match a callee or a member by, read from the
 * syntax tree rather than the source text, so a computed key (`orm["drizzle"]`)
 * or an indirect call (`(0, drizzle)(x)`) names the same thing as the plain
 * form. `keyName` is a member or property key, `memberName` a member's key,
 * and `calleeName` what a call or `new` invokes: a bare name, or the key of a
 * member.
 */
export const keyName = (
  key: Member["property"],
  computed: boolean
): string | undefined => {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  if (key.type === "TemplateLiteral" && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
};

export const memberName = (node: Member): string | undefined =>
  keyName(node.property, node.computed);

export const unwrap = (node: Expression): Expression => {
  if (node.type === "SequenceExpression") {
    const last = node.expressions.at(-1);
    return last ? unwrap(last) : node;
  }
  if (node.type === "ChainExpression") return unwrap(node.expression);
  if (node.type === "ParenthesizedExpression") return unwrap(node.expression);
  return node;
};

export const calleeName = (callee: Expression): string | undefined => {
  const node = unwrap(callee);
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return memberName(node);
  return undefined;
};
