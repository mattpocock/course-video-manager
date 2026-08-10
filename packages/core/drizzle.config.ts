import { defineConfig } from "drizzle-kit";
import { resolveMigrationDatabaseUrl } from "./db/database-url";

/**
 * The schema, the migrations and the tooling that reads them live TOGETHER, in
 * the package that owns them. `apps/local` held this config while it also held
 * the schema; it no longer holds either.
 *
 * Generating a migration (`db:generate`) is authoring, done on the author's
 * machine. APPLYING one (`db:migrate`) is the `apps/remote` deploy's job and
 * nobody else's — two writers racing to alter the production schema is the
 * failure this arrangement exists to prevent, so no script above this one wires
 * `db:migrate` up. See apps/remote/README.md.
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
