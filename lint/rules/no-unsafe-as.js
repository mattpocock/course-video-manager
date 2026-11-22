/** @type {import("./rule.ts").Rule} */
const rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      assertion:
        "Narrow the type instead of asserting it. Assertions are allowed only inside a generic function.",
    },
  },
  create(context) {
    return {
      "TSAsExpression, TSTypeAssertion"(node) {
        if (node.type !== "TSAsExpression" && node.type !== "TSTypeAssertion") {
          return;
        }
        if (context.sourceCode.getText(node.typeAnnotation) === "const") return;
        for (let n = node.parent; n; n = n.parent) {
          if (
            (n.type === "FunctionDeclaration" ||
              n.type === "FunctionExpression" ||
              n.type === "ArrowFunctionExpression") &&
            n.typeParameters &&
            n.typeParameters.params.length > 0
          ) {
            return;
          }
        }
        context.report({ node, messageId: "assertion" });
      },
    };
  },
};

export default rule;
