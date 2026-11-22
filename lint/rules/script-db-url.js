const URLS = new Set(["DATABASE_URL", "DIRECT_DATABASE_URL"]);
const QUOTES = /^["'`]|["'`]$/g;

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
    const text = context.sourceCode.getText.bind(context.sourceCode);
    const reported = new Set();
    return {
      Identifier(node) {
        if (node.name !== "loadEnvFile" || reported.has(node.start)) return;
        reported.add(node.start);
        context.report({ node, messageId: "loadEnvFile" });
      },
      MemberExpression(node) {
        if (
          text(node.object) === "process.env" &&
          URLS.has(text(node.property).replace(QUOTES, ""))
        ) {
          context.report({ node, messageId: "url" });
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type !== "ObjectPattern" ||
          !node.init ||
          text(node.init) !== "process.env"
        ) {
          return;
        }
        for (const property of node.id.properties) {
          if (
            property.type === "Property" &&
            URLS.has(text(property.key).replace(QUOTES, ""))
          ) {
            context.report({ node: property, messageId: "url" });
          }
        }
      },
    };
  },
};
