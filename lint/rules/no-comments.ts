import { directiveOf } from "./allowed-directives.js";
import type { NodeOf, Rule, Visitor } from "./rule.ts";

type Context = Parameters<NonNullable<Rule["create"]>>[0];
type Comment = ReturnType<Context["sourceCode"]["getAllComments"]>[number];
type Node = NodeOf<"MethodDefinition">["parent"];

const TOOL_DIRECTIVE = /^\s*(?:(?:oxlint|eslint)-enable\b|prettier-ignore\b)/;
const TRIPLE_SLASH_REFERENCE = /^\/\s*<reference\s/;

const isToolDirective = (comment: Comment) =>
  comment.type === "Shebang" ||
  directiveOf(comment.value) !== undefined ||
  TOOL_DIRECTIVE.test(comment.value) ||
  (comment.type === "Line" && TRIPLE_SLASH_REFERENCE.test(comment.value));

const isJsDoc = (comment: Comment) =>
  comment.type === "Block" && comment.value.startsWith("*");

const EXPORTS = new Set([
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
]);

const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const MEMBERS = [
  "MethodDefinition",
  "PropertyDefinition",
  "AccessorProperty",
  "TSAbstractMethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSAbstractAccessorProperty",
  "TSPropertySignature",
  "TSMethodSignature",
  "Property",
] as const;

const isExportedMember = (member: Node) => {
  for (let n = member.parent; n; n = n.parent) {
    if (FUNCTIONS.has(n.type)) return false;
    if (EXPORTS.has(n.type)) return true;
  }
  return false;
};

const allowsInterfaceJsDoc = (options: unknown) =>
  typeof options === "object" &&
  options !== null &&
  "allowInterfaceJsDoc" in options &&
  options.allowInterfaceJsDoc === true;

const rule: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow comments, except tool directives and, on an entry point, interface JSDoc.",
    },
    schema: [
      {
        type: "object",
        properties: { allowInterfaceJsDoc: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      comment:
        'Comments are not allowed: say it with a name, a type or a test, and move a decision record into an ADR (docs/adr/). The only comment allowed is interface JSDoc on an entry point (CODING_STANDARDS.md, "Comments").',
      jsdoc:
        "JSDoc is allowed only on an entry point's interface: its file-leading block, and the last JSDoc block before an export or a member of one. Entry points are the root files of apps/local/app/packages/<pkg>/ and the files a workspace package's exports map names. Anywhere else, say it with a name, a type or a test, and move a decision record into an ADR (docs/adr/).",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const interfaceDocs = new Set<number>();

    const allowLastJsDocBefore = (node: Node) => {
      const last = sourceCode
        .getCommentsBefore(node)
        .filter((comment) => !isToolDirective(comment))
        .at(-1);
      if (last && isJsDoc(last)) interfaceDocs.add(last.range[0]);
    };

    const allowFileLeadingJsDoc = (comments: readonly Comment[]) => {
      const first = comments.find((comment) => !isToolDirective(comment));
      if (first && isJsDoc(first) && !sourceCode.getTokenBefore(first)) {
        interfaceDocs.add(first.range[0]);
      }
    };

    const reportComments = () => {
      for (const comment of sourceCode.getAllComments()) {
        if (isToolDirective(comment)) continue;
        if (interfaceDocs.has(comment.range[0])) continue;
        context.report({
          loc: comment.loc,
          messageId: isJsDoc(comment) ? "jsdoc" : "comment",
        });
      }
    };

    if (!allowsInterfaceJsDoc(context.options[0])) {
      return { "Program:exit": reportComments };
    }

    const visitor: Visitor = {
      Program() {
        allowFileLeadingJsDoc(sourceCode.getAllComments());
      },
      ExportNamedDeclaration: allowLastJsDocBefore,
      ExportDefaultDeclaration: allowLastJsDocBefore,
      ExportAllDeclaration: allowLastJsDocBefore,
      "Program:exit": reportComments,
    };
    for (const member of MEMBERS) {
      visitor[member] = (node: Node) => {
        if (isExportedMember(node)) allowLastJsDocBefore(node);
      };
    }
    return visitor;
  },
};

export default rule;
