import { calleeName, memberName, unwrap } from "./names.ts";

const TABLES = new Set([
  "clips",
  "clipWebLinks",
  "clipTranscriptWords",
  "overlays",
]);

const SQL_INSERT =
  /insert\s+into\s+"?(?:course-video-manager_)?(?:clip|clip_web_link|clip_transcript_word|overlay)"?[\s(]/i;

/**
 * Fails an insert into the Clip table or a Clip child table outside the
 * allowed writers, because a hand-written copy can drop Clip children.
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow inserts into the Clip and Clip child tables outside the allowed writers.",
    },
    schema: [],
    messages: {
      insert:
        "Clip rows inserted outside the allowed writers. Copies go through copyClipsOntoVideo (packages/core/services/copy-child-rows.ts) and must be listed in COPY_PATHS (packages/core/services/version-copy-manifest.ts), so the copy-path guards hold them to carrying every Clip child. Creating genuinely fresh Clips? Add the file, with its reason, to the local/clip-inserts override in .oxlintrc.json.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const method = calleeName(node.callee);
        const table =
          method === "insert" && unwrap(node.callee).type === "MemberExpression"
            ? node.arguments[0]
            : method === "insertInChunks"
              ? node.arguments[1]
              : undefined;
        if (
          (table?.type === "Identifier" && TABLES.has(table.name)) ||
          (table?.type === "MemberExpression" &&
            table.object.type === "Identifier" &&
            table.object.name === "schema" &&
            TABLES.has(memberName(table) ?? ""))
        ) {
          context.report({ node, messageId: "insert" });
        }
      },
      Literal(node) {
        if (typeof node.value === "string" && SQL_INSERT.test(node.value)) {
          context.report({ node, messageId: "insert" });
        }
      },
      TemplateElement(node) {
        if (SQL_INSERT.test(node.value.raw)) {
          context.report({ node, messageId: "insert" });
        }
      },
    };
  },
};
