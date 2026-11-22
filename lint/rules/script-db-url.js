import {
  destructuredDatabaseUrls,
  touchesDatabaseUrl,
} from "./database-url-reads.ts";

const HELPER =
  "Use scriptDatabaseUrl() from apps/local/scripts/script-database-url.ts instead: const { url, host } = scriptDatabaseUrl(); ({ direct: true } for schema work). It loads the repo-root .env as drizzle.config.ts does, lets the shell win, and prints the target host.";

/**
 * Fails a one-off DB script that resolves its database URL by hand, so it
 * cannot silently hit a different database than the operator thinks.
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow DATABASE_URL access and loadEnvFile in one-off DB scripts.",
    },
    schema: [],
    messages: {
      url: `A DB script reads its database URL by hand. ${HELPER}`,
      loadEnvFile: `A DB script loads .env by hand. ${HELPER}`,
    },
  },
  create(context) {
    return {
      Identifier(node) {
        const parent = node.parent;
        const isImportAlias =
          parent.type === "ImportSpecifier" &&
          parent.local === node &&
          parent.imported !== node;
        if (node.name === "loadEnvFile" && !isImportAlias) {
          context.report({ node, messageId: "loadEnvFile" });
        }
      },
      MemberExpression(node) {
        if (touchesDatabaseUrl(node)) {
          context.report({ node, messageId: "url" });
        }
      },
      ObjectPattern(node) {
        for (const property of destructuredDatabaseUrls(node)) {
          context.report({ node: property, messageId: "url" });
        }
      },
    };
  },
};
