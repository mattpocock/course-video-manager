import { calleeName, unwrap } from "./names.ts";

/**
 * @param {import("./names.ts").Expression} node
 * @param {number} value
 */
const isNumericLiteral = (node, value) => {
  const inner = unwrap(node);
  return inner.type === "Literal" && inner.value === value;
};

/**
 * Fails a hand-rolled `m:ss` formatter: a file that takes a value modulo 60
 * and zero-pads to two digits. Every duration on screen goes through
 * `formatDuration` (apps/local/app/lib/format-duration.ts).
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hand-rolled m:ss duration formatting outside formatDuration.",
    },
    schema: [],
    messages: {
      handRolled:
        "A duration formatted by hand (% 60 in a file that pads to two digits with padStart(2)). Format the duration with formatDuration from @/lib/format-duration. It reads m:ss under an hour and h:mm:ss from one, the same everywhere.",
    },
  },
  create(context) {
    /** @type {import("./names.ts").Expression[]} */
    const modulos = [];
    let pads = false;
    return {
      BinaryExpression(node) {
        if (node.operator === "%" && isNumericLiteral(node.right, 60)) {
          modulos.push(node);
        }
      },
      AssignmentExpression(node) {
        if (node.operator === "%=" && isNumericLiteral(node.right, 60)) {
          modulos.push(node);
        }
      },
      CallExpression(node) {
        const arg = node.arguments[0];
        if (
          unwrap(node.callee).type === "MemberExpression" &&
          calleeName(node.callee) === "padStart" &&
          arg !== undefined &&
          arg.type !== "SpreadElement" &&
          isNumericLiteral(arg, 2)
        ) {
          pads = true;
        }
      },
      "Program:exit"() {
        if (!pads) return;
        for (const node of modulos) {
          context.report({ node, messageId: "handRolled" });
        }
      },
    };
  },
};
