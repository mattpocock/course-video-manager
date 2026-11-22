const isAmbient = (node) => {
  for (let n = node; n; n = n.parent) {
    if (n.declare) return true;
  }
  return false;
};

/** @type {import("./rule.ts").Rule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow function and method overload signatures, which the implementation signature is never checked against.",
    },
    schema: [],
    messages: {
      overload:
        "Overload signatures are not checked against the implementation. Use one signature, a union of inputs with a discriminant, or a generic.",
    },
  },
  create(context) {
    if (context.filename.endsWith(".d.ts")) return {};
    return {
      TSDeclareFunction(node) {
        if (!isAmbient(node)) context.report({ node, messageId: "overload" });
      },
      "MethodDefinition > TSEmptyBodyFunctionExpression"(node) {
        if (!isAmbient(node)) {
          context.report({ node: node.parent, messageId: "overload" });
        }
      },
    };
  },
};

export default rule;
