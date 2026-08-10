import { defineConfig } from "drizzle-kit";
import { resolveMigrationDatabaseUrl } from "@cvm/core/db/database-url";

export default defineConfig({
  dialect: "postgresql",
  schema: "../../packages/core/db/schema.ts",
  out: "../../packages/core/db/migrations",
  dbCredentials: {
    // Migrations run through the direct connection, never the pooler.
    url: resolveMigrationDatabaseUrl()!,
  },
  tablesFilter: ["course-video-manager_*"],
});
