const CLIENTS = new Set(["Pool", "Client", "pg.Pool", "pg.Client", "PGlite"]);
const FACTORIES = new Set(["postgres", "neon", "drizzle"]);
const URLS = new Set(["DATABASE_URL", "DIRECT_DATABASE_URL"]);
const QUOTES = /^["'`]|["'`]$/g;

const FACTORY_LIST =
  "app / server code: DrizzleService (@cvm/core/services/drizzle-service.server); one-off DB scripts: scriptPgClient() / scriptDrizzle() (apps/local/scripts/script-database-url.ts); tests: createTestDb() / createBlankDb() / withQueryLog() (packages/core/test-utils/test-db.ts); the URL alone: resolveDatabaseUrl() (@cvm/core/db/database-url)";

/**
 * Fails a database client built, or its connection string read, outside the
 * guarded factories, which run the connection guard
 * (packages/core/db/connection-guard.ts) before they connect.
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow database clients and DATABASE_URL reads outside the guarded factories.",
    },
    schema: [],
    messages: {
      client: `A client built by hand skips the connection guard (packages/core/db/connection-guard.ts), which stops a git worktree opening a writable connection to production. Use a factory: ${FACTORY_LIST}.`,
      url: `Reading the database URL by hand skips the connection guard (packages/core/db/connection-guard.ts), which stops a git worktree opening a writable connection to production. Use a factory: ${FACTORY_LIST}.`,
    },
  },
  create(context) {
    const text = context.sourceCode.getText.bind(context.sourceCode);
    return {
      NewExpression(node) {
        if (CLIENTS.has(text(node.callee))) {
          context.report({ node, messageId: "client" });
        }
      },
      CallExpression(node) {
        const name = text(node.callee).split(".").pop();
        if (name !== undefined && FACTORIES.has(name)) {
          context.report({ node, messageId: "client" });
        }
      },
      MemberExpression(node) {
        if (text(node.object) !== "process.env") return;
        if (!URLS.has(text(node.property).replace(QUOTES, ""))) return;
        const parent = node.parent;
        if (
          parent.type === "AssignmentExpression" &&
          parent.operator === "=" &&
          parent.left === node
        ) {
          return;
        }
        if (parent.type === "UnaryExpression" && parent.operator === "delete") {
          return;
        }
        context.report({ node, messageId: "url" });
      },
      ObjectPattern(node) {
        const parent = node.parent;
        const source =
          parent.type === "VariableDeclarator"
            ? parent.init
            : parent.type === "AssignmentExpression"
              ? parent.right
              : null;
        if (!source || text(source) !== "process.env") return;
        for (const property of node.properties) {
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
