import {
  destructuredDatabaseUrls,
  isWrite,
  touchesDatabaseUrl,
} from "./database-url-reads.ts";
import { calleeName, memberName, unwrap } from "./names.ts";

const CLIENTS = new Set(["Pool", "Client", "PGlite"]);
const PG_CLIENTS = new Set(["Pool", "Client"]);
const FACTORIES = new Set(["postgres", "neon", "drizzle"]);

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
    schema: [
      {
        type: "object",
        properties: { reads: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      client: `A client built by hand skips the connection guard (packages/core/db/connection-guard.ts), which stops a git worktree opening a writable connection to production. Use a factory: ${FACTORY_LIST}.`,
      url: `Reading the database URL by hand skips the connection guard (packages/core/db/connection-guard.ts), which stops a git worktree opening a writable connection to production. Use a factory: ${FACTORY_LIST}.`,
    },
  },
  create(context) {
    const reads = context.options[0]?.reads !== false;
    return {
      NewExpression(node) {
        const callee = unwrap(node.callee);
        if (
          (callee.type === "Identifier" && CLIENTS.has(callee.name)) ||
          (callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            callee.object.name === "pg" &&
            PG_CLIENTS.has(memberName(callee) ?? ""))
        ) {
          context.report({ node, messageId: "client" });
        }
      },
      CallExpression(node) {
        if (FACTORIES.has(calleeName(node.callee) ?? "")) {
          context.report({ node, messageId: "client" });
        }
      },
      MemberExpression(node) {
        if (reads && touchesDatabaseUrl(node) && !isWrite(node)) {
          context.report({ node, messageId: "url" });
        }
      },
      ObjectPattern(node) {
        if (!reads) return;
        for (const property of destructuredDatabaseUrls(node)) {
          context.report({ node: property, messageId: "url" });
        }
      },
    };
  },
};
