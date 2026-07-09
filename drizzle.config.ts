import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/db/schema.ts",
  out: "./app/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  tablesFilter: ["course-video-manager_*"],
});
