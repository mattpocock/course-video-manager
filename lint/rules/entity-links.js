import {
  calleeName,
  keyName,
  memberName,
  unwrap,
  unwrapCasts,
} from "./names.ts";

const APP_PATH = /^\/(?:videos|courses|pitches|diagram-playground)\//;
const ID_NAME = /(?:^id|[a-z]Id)$/;

const GUIDANCE =
  "Render the entity's menu with EntityMenuContent, whose Copy Link builds the URL with entityDeepLink (features/entity-links/). It names the whole hierarchy, and cvm takes it wherever it takes an id.";

/** @param {import("./names.ts").Expression} node */
const nameOf = (node) => calleeName(unwrapCasts(node));

/**
 * @param {import("./names.ts").Expression | null | undefined} node
 * @returns {boolean}
 */
const isLocation = (node) => !!node && nameOf(node) === "location";

/**
 * @param {import("./names.ts").Expression} node
 * @returns {boolean}
 */
const startsWithAppPath = (node) => {
  const inner = unwrapCasts(node);
  if (inner.type === "Literal") {
    return typeof inner.value === "string" && APP_PATH.test(inner.value);
  }
  if (inner.type === "TemplateLiteral") {
    const [first, second] = inner.quasis;
    const head = first?.value.cooked ?? "";
    return (
      APP_PATH.test(head) ||
      (head === "" && APP_PATH.test(second?.value.cooked ?? ""))
    );
  }
  if (inner.type === "BinaryExpression" && inner.operator === "+") {
    return (
      inner.left.type !== "PrivateIdentifier" && startsWithAppPath(inner.left)
    );
  }
  return false;
};

/**
 * @param {import("./names.ts").Expression | undefined} arg
 * @returns {boolean}
 */
const isHandBuiltLink = (arg) => {
  if (arg === undefined) return false;
  const name = nameOf(arg);
  return (name !== undefined && ID_NAME.test(name)) || startsWithAppPath(arg);
};

/**
 * Fails a CVM link or raw id put on the clipboard by hand, and any
 * `location.origin`, which only a hand-built absolute app URL needs. Links
 * are built by `entityDeepLink` (apps/local/app/features/entity-links/).
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hand-built CVM links and raw ids on the clipboard, and location.origin.",
    },
    schema: [],
    messages: {
      clipboard: `A CVM link or raw id put on the clipboard by hand. ${GUIDANCE}`,
      origin: `location.origin is only needed for a hand-built absolute app URL. ${GUIDANCE}`,
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (
          callee.type === "MemberExpression" &&
          memberName(callee) === "writeText" &&
          nameOf(callee.object) === "clipboard" &&
          node.arguments[0]?.type !== "SpreadElement" &&
          isHandBuiltLink(node.arguments[0])
        ) {
          context.report({ node, messageId: "clipboard" });
        }
      },
      MemberExpression(node) {
        if (memberName(node) === "origin" && isLocation(node.object)) {
          context.report({ node, messageId: "origin" });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !isLocation(node.init)) return;
        for (const property of node.id.properties) {
          if (
            property.type === "Property" &&
            keyName(property.key, property.computed) === "origin"
          ) {
            context.report({ node: property, messageId: "origin" });
          }
        }
      },
    };
  },
};
