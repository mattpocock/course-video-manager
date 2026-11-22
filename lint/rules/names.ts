import type { NodeOf, Visitor } from "./rule.ts";

export type Member = NodeOf<"MemberExpression">;
export type Expression = Member["object"];

/**
 * The names the local rules match a callee or a member by, read from the
 * syntax tree rather than the source text, so a computed key (`orm["drizzle"]`)
 * or an indirect call (`(0, drizzle)(x)`) names the same thing as the plain
 * form. `keyName` is a member or property key, `memberName` a member's key,
 * `unwrap` strips parentheses, `?.` and a sequence's leading expressions,
 * `unwrapCasts` also strips `as`, `!`, `satisfies` and `<T>` (which
 * `unwrap` keeps, because `local/response-body` bans some of them),
 * `calleeName` what a call or `new` invokes: a bare name, or the key of a
 * member, and `nameReferences` a visitor that reports each place one of
 * `names` is named, as an identifier or a computed key, once.
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

export const unwrapCasts = (node: Expression): Expression => {
  const inner = unwrap(node);
  if (
    inner.type === "TSAsExpression" ||
    inner.type === "TSNonNullExpression" ||
    inner.type === "TSSatisfiesExpression" ||
    inner.type === "TSTypeAssertion"
  ) {
    return unwrapCasts(inner.expression);
  }
  return inner;
};

export const calleeName = (callee: Expression): string | undefined => {
  const node = unwrap(callee);
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return memberName(node);
  return undefined;
};

type Named =
  NodeOf<"Identifier"> | Member["property"] | NodeOf<"Property">["key"];

export const nameReferences = (
  names: ReadonlySet<string>,
  report: (node: Named) => void
): Visitor => {
  const reported = new Set<number>();
  const once = (node: Named) => {
    if (reported.has(node.range[0])) return;
    reported.add(node.range[0]);
    report(node);
  };
  return {
    Identifier(node) {
      if (names.has(node.name)) once(node);
    },
    MemberExpression(node) {
      if (node.computed && names.has(memberName(node) ?? "")) {
        once(node.property);
      }
    },
    Property(node) {
      if (node.computed && names.has(keyName(node.key, true) ?? "")) {
        once(node.key);
      }
    },
  };
};
