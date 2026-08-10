import { defineConfig } from "drizzle-kit";
import { resolveMigrationDatabaseUrl } from "./app/db/database-url";

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/db/schema.ts",
  out: "./app/db/migrations",
  dbCredentials: {
    // Migrations run through the direct connection, never the pooler.
    url: resolveMigrationDatabaseUrl()!,
  },
  tablesFilter: ["course-video-manager_*"],
});
