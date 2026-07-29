import { defineConfig } from "vite";

// PROTOTYPE — throwaway. Standalone vite app, deliberately independent of the
// CVM react-router app so it needs no database, no env, no auth.
export default defineConfig({
  root: import.meta.dirname,
  server: { port: 5311, strictPort: true },
  esbuild: { jsx: "automatic" },
  resolve: { dedupe: ["react", "react-dom", "tldraw", "@tldraw/editor"] },
});
