import { defineConfig } from "drizzle-kit";
import { resolveMigrationDatabaseUrl } from "./db/database-url.js";

/**
 * The schema, the migrations and the tooling that reads them live TOGETHER, in
 * the package that owns them. `apps/local` held this config while it also held
 * the schema; it no longer holds either.
 *
 * Generating a migration (`db:generate`) is authoring, done on the author's
 * machine. APPLYING one (`db:migrate`) is also done by hand, from the root
 * (`pnpm db:migrate`) — the `apps/remote` deploy no longer runs it, because
 * that ran on every Vercel build, previews included, and could land an
 * unmerged migration on the production schema. See ADR 0026 and
 * apps/remote/README.md.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    // Migrations run through the direct connection, never the pooler.
    url: resolveMigrationDatabaseUrl()!,
  },
  tablesFilter: ["course-video-manager_*"],
});
