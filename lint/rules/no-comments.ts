import { isToolDirective } from "./directives.ts";
import { removeComment } from "./remove-comment.ts";
import type { NodeOf, Rule, Visitor } from "./rule.ts";

type Context = Parameters<NonNullable<Rule["create"]>>[0];
type Comment = ReturnType<Context["sourceCode"]["getAllComments"]>[number];
type AnyNode = NodeOf<"MethodDefinition">["parent"];

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

const isExportedMember = (member: AnyNode) => {
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
    type: "suggestion",
    hasSuggestions: true,
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
        'JSDoc is allowed only on an entry point\'s interface (entry points: CLAUDE.md, "Deep-module packages"): its file-leading block, and the last JSDoc block before an export or a member of one. Anywhere else, say it with a name, a type or a test, and move a decision record into an ADR (docs/adr/).',
      remove: "Delete the comment.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const interfaceDocs = new Set<number>();

    const allowLastJsDocBefore = (node: AnyNode) => {
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
          suggest: [
            {
              messageId: "remove",
              fix: (fixer) =>
                removeComment(fixer, sourceCode.text, comment.range),
            },
          ],
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
      visitor[member] = (node: AnyNode) => {
        if (isExportedMember(node)) allowLastJsDocBefore(node);
      };
    }
    return visitor;
  },
};

export default rule;
