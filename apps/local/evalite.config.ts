import { defineConfig } from "evalite/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { createSqliteStorage } from "evalite/sqlite-storage";

export default defineConfig({
  viteConfig: {
    plugins: [tsconfigPaths()],
  } as any,
  testTimeout: 120_000,
  storage: () => createSqliteStorage("./node_modules/.evalite/db.sqlite"),
});
